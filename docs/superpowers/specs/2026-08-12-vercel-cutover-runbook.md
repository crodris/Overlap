# Vercel Cutover Runbook

Date: 2026-08-12
Companion to: `2026-08-12-vercel-migration-design.md`
Status: code complete and reviewed; these steps are not yet done

All code for the migration is merged on `feat/vercel-migration`.
Everything in this document is operational work on live accounts, which is why it was not automated.

Each risk below was found during implementation or review, not anticipated in the original design.
They are ordered by when they bite, and the ones marked REQUIRED will cause a silent failure if skipped.

## Before touching anything

Record the current `repository_settings` row from Railway.

The migration deliberately restores no data (see the design's Database section), because almost every table is a rebuildable cache of GitHub state.
`repository_settings` is the exception: `pruningDays` and `ignoredPaths` are user-configured and reconstructible from nothing.
If they differ from the defaults in `packages/shared/src/constants/index.ts`, write them down now and re-enter them after cutover.

## Supabase

**REQUIRED, before the app writes anything: close the Data API for the `public` schema.**

Railway Postgres had no HTTP surface.
Supabase serves PostgREST at `/rest/v1` on the public internet, authenticated by an anon key that is public by design, and the restored schema has no row-level security.
`webhook_events` stores complete GitHub payloads, which makes it the highest-value target in the database.

Verify from outside the network before proceeding:

```bash
curl -s "https://<project>.supabase.co/rest/v1/users?select=*" -H "apikey: <anon-key>" | head
```

Row data coming back means stop and fix.

Then create the schema:

```bash
DIRECT_URL=<direct-connection> pnpm db:migrate
```

**REQUIRED: confirm the unique constraint on `webhook_events.delivery_id` actually exists afterwards.**
The entire idempotency design rests on it.
`onConflictDoNothing` against a missing constraint does not error, it simply never conflicts, so every GitHub redelivery would start a duplicate billed workflow run.
The constraint is declared in `packages/db/drizzle/0000_woozy_prima.sql`, so a clean migrate creates it; verify rather than assume.

**Connection strings, and this one is easy to get wrong:**

- `DATABASE_URL` must be the Supavisor **transaction pooler**, port **6543**
- `DIRECT_URL` must be the **direct connection**, port **5432**

`.env.example` ships `localhost:5432` in both slots for local development.
Copy-pasting that shape into production runs the app through a direct connection and exhausts it, or runs migrations through the pooler where they cannot work.

## Vercel

**REQUIRED: check where `vercel.json` needs to live.**

It currently sits at the repo root and contains only the `crons` array.
If the project's Root Directory is set to `apps/web`, a repo-root `vercel.json` is never read, and **both cron jobs silently never fire**.
There is no error; branch pruning and event cleanup simply stop happening.
Confirm the Root Directory in project settings and move the file into `apps/web/` if that is where the project is rooted.

**Environment variables.** Set everything in `.env.example`, plus:

- `SESSION_SECRET` must be a NEW value, not the Railway one. Rotating it guarantees every previously issued cookie fails closed.
- `CRON_SECRET` fails closed. If unset, both cron endpoints return 401 forever with no other symptom.
- `VAPID_SUBJECT` must be the real production domain. The placeholder is deliberately non-functional.

**REQUIRED: add Vercel Firewall rate limit rules on `/api/webhooks/github` and `/api/auth/*`.**

The old `@fastify/rate-limit` was dropped with no in-code replacement, because its in-memory store was already per-instance and not delivering the guarantee it appeared to.
On Railway a request flood wasted CPU you had already paid for.
On Vercel every request is a billed invocation, so the same flood is a direct bill.
`/api/webhooks/github` is the worst exposure: public, unauthenticated, and it computes an HMAC on every request before it can reject one.

## GitHub App

**REQUIRED: both URLs changed PATH, not just host.**

- Webhook: `/webhooks/github` becomes **`/api/webhooks/github`**
- OAuth callback: `/auth/github/callback` becomes **`/api/auth/github/callback`**

A host-only flip produces a 404 on every delivery, and an OAuth `redirect_uri` mismatch on every sign-in, because `apps/web/src/routes/api/auth/github.ts` sends the new path as `redirect_uri`.

## Verification, in order

Do this against a preview deployment with a second GitHub App on a throwaway repository, before touching production.

1. Sign in end to end. This is the one path never exercised by an automated test, and it is where the last defect of the migration was found.
2. Push a commit. Confirm the check run appears.
3. Open a pull request. Confirm the push notification arrives.
4. Inspect the runs: `npx workflow inspect runs --backend vercel --project <project> --team crod`
5. **Measure cold-start latency against GitHub's 10 second webhook timeout.** The route does a repository lookup, an insert, `start()`, and an update before responding, which is four round trips to Supabase rather than one. This is unmeasured and should not be assumed.

Then flip production, sign in, reinstall the App on the real repository, and confirm the pipeline reconstructs the same branches and overlaps Railway is still serving.
That comparison is the acceptance test for the whole migration.
Railway stays untouched until it passes, so rollback is repointing one URL.

## Operating notes

**Recovering a failed delivery.** GitHub's Redeliver button is now curative: a delivery whose run failed terminally (`error` set, `processedAt` null) or never dispatched (`dispatched_at` null) will start a fresh run on redelivery. A delivery already in flight or already processed will not restart. This is the only operator recovery lever, so it is worth knowing it exists.

**Failure blast radius is wider than BullMQ's.** A terminal `postCheckRun` or `sendPush` failure now leaves `webhook_events.processed_at` NULL and sets `error`, where previously a feedback-job failure never touched that row. That is the correct consequence of making a delivery one durable unit.

**Every delivery costs a workflow run**, including event types the workflow classifies as unhandled. This matches the old behavior, but on Vercel it is billed. Keep the GitHub App's event subscriptions tight.

**Known limitations, all accepted deliberately:**

- Check-run idempotency is narrowed, not closed. A crash between the GitHub call returning and the `pr_alerts` write can still produce one duplicate check run.
- Redelivery dedup is narrowed, not closed, for the same structural reason: `@workflow/core` exposes no start-time idempotency key, so there is no atomic link between "durable run created" and "local row updated".
- `processWebhook` renders as an empty graph in workflow visualizations, because the static graph builder emits an empty DAG for any workflow containing try/catch. Execution is unaffected; the manifest is diagnostics-only. Durable failure bookkeeping was judged worth more than the picture.

## Follow-ups worth a ticket, none blocking

- The repository has no CI. `pnpm test:integration` is the only proof the migration's central ordering property holds, and nothing runs it on push.
- Observability regressed: the pino logger is gone with `apps/api`, and `apps/web/src/routes/api/health.ts` swallows its database error with a bare `catch {}`.
- `apps/web/src/routes/__root.tsx` references `/favicon.ico`, which has never existed in `apps/web/public/`. Pre-existing, 404s on every page load.
- The branch-deletion cleanup resolves overlaps to `resolved` immediately before deleting the branch rows, which cascade-delete them anyway. The update is inert and its comment overstates what it does.
