# Vercel Migration Design

Date: 2026-08-12
Status: Implemented. Superseded in one respect, see the amendment below.

## Amendment, 2026-08-13: the database provider is Neon, not Supabase

This document was written against Supabase and implemented that way in every respect that touches code, which is to say hardly any: `packages/db` takes a pooled Postgres connection string and nothing in the branch is provider-specific.

The provider changed at cutover time for a cost reason the design did not anticipate.
Supabase's monthly compute credit was already fully consumed by another project in the same account, so adding this one was $10/month of genuinely new spend.
Since the entire motivation for this migration was removing a $5/month always-on Railway worker, that would have left the project $5/month worse off than doing nothing.
Neon's free tier absorbs this workload with room to spare.

Two consequences for the sections below:

- **S1 no longer applies and is retained only as a record.** It required closing Supabase's public Data API, which does not exist on Neon. That risk is eliminated rather than mitigated.
- **The pooled and direct connection strings differ by hostname, not port.** Neon's pooled endpoint carries a `-pooler` suffix; both use 5432. Wherever this document says port 6543, read "the `-pooler` hostname" instead.

`docs/superpowers/specs/2026-08-12-vercel-cutover-runbook.md` is the operational document and is correct as written.
Everything else here stands.

## Summary

Move Overlap off Railway and onto Vercel + Supabase.
Collapse three deployed apps into one Vercel project.
Replace the always-on BullMQ worker with Vercel Workflow DevKit (WDK) durable workflows.
Delete Redis entirely.

## Motivation

Railway bills per second for running services, and the BullMQ worker is always-on by design.
For a low-traffic app that means paying continuously for an idle process.

The Vercel account is already on a paid Pro plan, and Supabase is already paid for.
Adding Overlap to both costs approximately zero marginal spend at current traffic, because Pro's included allowances far exceed what this app consumes.
The migration therefore removes new spend rather than shifting it.

A secondary motivation is correctness.
The current job graph contains a race condition papered over with a fixed delay, and two error handlers that silently corrupt data.
Both are fixed as part of this work rather than carried across.

## Current architecture

Three Railway services plus two Railway databases.

| Component | Implementation |
| --- | --- |
| `apps/web` | TanStack Start SSR on Nitro, Vite 7, deployed via Dockerfile |
| `apps/api` | Fastify 5, five route groups, BullMQ producer, job scheduler |
| `apps/worker` | Six always-on BullMQ `Worker` instances with per-queue concurrency and rate limiters |
| Postgres | Railway-provisioned, accessed through Drizzle ORM and `postgres-js` |
| Redis | Railway-provisioned, used only as BullMQ's backing store |

### Verified: Redis has exactly one consumer

Redis is referenced in five files, and every reference is BullMQ.

- `apps/api/src/queues/index.ts` - queue connection
- `apps/api/src/scheduler.ts` - repeatable job scheduler
- `apps/worker/src/index.ts` - worker connection
- `apps/worker/src/processors/webhook-events.ts` - opens its own connection to enqueue follow-on jobs
- `apps/worker/src/processors/overlap-detection.ts` - same

`apps/api/src/routes/health.ts` pings Redis, but only to confirm BullMQ is reachable.

Sessions do not use Redis.
`apps/api/src/plugins/auth.ts` uses a signed cookie plus a Postgres lookup.
Rate limiting does not use Redis either.
`@fastify/rate-limit` is registered with its default in-memory store.

Redis is therefore not a separate decision.
It has one consumer, and this design replaces that consumer.

### Current job graph

```
webhook POST /webhooks/github
  |- inline: verify HMAC, store webhook_events row, handle branch deletion
  \- enqueue webhook_events
       |- enqueue branch_sync
       |- enqueue overlap_detection   (delay: 5000)
       \- enqueue maintenance:sync_repository   (on installation events)

overlap_detection
  |- enqueue github_feedback   (per open PR)
  \- enqueue push_notification
```

## Target architecture

One Vercel project.
`apps/web` absorbs both the API and the worker.

```
apps/web/
  src/routes/            UI routes, unchanged
  src/routes/api/        former apps/api, as TanStack Start server routes
  src/workflows/         former apps/worker, as WDK workflows and steps
packages/db              survives, pooler connection string and prepare:false
packages/github          survives untouched
packages/shared          survives, minus QUEUE_NAMES and RATE_LIMITS
```

Removed from the repository:

- `apps/api` and `apps/worker` as deployed apps
- `apps/web/Dockerfile`, `apps/api/Dockerfile`, `apps/worker/Dockerfile`
- `railway.json` at the root and in all three apps
- `bullmq` and `ioredis` dependencies
- the Redis service in `docker-compose.yml`
- the `REDIS_URL` environment variable

## Design

### Workflow decomposition

Each GitHub delivery becomes one durable workflow run.

```ts
export async function processWebhook(deliveryId: string) {
  "use workflow"

  const evt = await loadEvent(deliveryId)

  if (evt.type === "push") {
    const branchId = await upsertBranch(evt)
    await syncBranchFiles(branchId, evt)
    const results = await detectOverlaps(branchId)
    for (const n of results.notifications) {
      await postCheckRun(n)
      await sendPush(n)
    }
  }

  // pull_request and installation branches follow the same shape
}
```

Every named function above is a `"use step"` function.
The workflow function itself only orchestrates, so it never touches Node APIs and never hits the workflow sandbox restrictions.

Step functions map one to one onto the existing processors:

| Current processor | Becomes |
| --- | --- |
| `webhook-events.ts` | `loadEvent`, `upsertBranch`, `upsertPullRequest`, `syncInstallation` |
| `branch-sync.ts` | `syncBranchFiles` |
| `overlap-detection.ts` | `detectOverlaps` |
| `github-feedback.ts` | `postCheckRun` |
| `push-notification.ts` | `sendPush` |
| `maintenance.ts` | `pruneStaleBranches`, `cleanupEvents`, `syncRepository` |

### The five-second delay is deleted

`apps/worker/src/processors/webhook-events.ts:150` reads:

```ts
delay: 5000, // Small delay to ensure sync completes first
```

Branch sync and overlap detection are separate BullMQ queues with no ordering guarantee between them.
The delay is a hope, not a constraint.
If `syncBranchFiles` takes longer than five seconds on a large diff or a slow GitHub response, detection reads a stale file list and computes incorrect overlaps.
If it finishes in 200ms, the pipeline stalls for 4.8 seconds for no reason.

In the workflow, `await syncBranchFiles(...)` followed by `await detectOverlaps(...)` is a durable happens-before edge.
The delay is removed.
Correctness improves and median latency drops by roughly five seconds.

This is the primary reason WDK was chosen over Vercel Queues.
Two queue topics would have reproduced the same race that two BullMQ queues have today.

### Idempotency

BullMQ's `jobId` deduplication disappears and is replaced at the front door, using the unique constraint that already exists on `webhook_events.deliveryId`.

HMAC verification is a hard precondition on everything below.
No database write and no workflow start may occur before the signature is confirmed valid.

```ts
const raw = await request.text()                     // raw bytes, before any JSON parse
const sig = request.headers.get("x-hub-signature-256")

const verification = verifyWebhookSignature(raw, sig, process.env.GITHUB_WEBHOOK_SECRET)
if (!verification.valid) {
  return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 })
}

const payload = JSON.parse(raw)

const [row] = await db.insert(webhookEvents)
  .values({ deliveryId, eventType, payload, repositoryId })
  .onConflictDoNothing()
  .returning()

if (!row) return Response.json({ received: true })   // GitHub redelivery

await start(processWebhook, [deliveryId])
```

Ordering matters and is not stylistic.
Inverting it produces a public unauthenticated endpoint that writes attacker-controlled JSON into `webhook_events` and starts a billed workflow run per request.

This is stronger than the current behaviour.
Deduplication state lives durably in Postgres rather than expiring out of Redis on a TTL.

Within a run, WDK memoizes completed step results across replays, so a retry after a partial failure does not re-post a check run or re-send a push notification.

Three existing workarounds are deleted rather than ported:

- The `jobSuffix` timestamp in `overlap-detection.ts:196`, added specifically to defeat deduplication for reactivated overlaps
- The `jobId` built from `repo.id`, `branchId` and `Date.now()` in `webhook-events.ts:148`, a deduplication key containing a timestamp, which deduplicates nothing
- commit `bb92e78`, "replace colons in BullMQ job IDs to fix notification delivery"

Each is a symptom of working around BullMQ's deduplication semantics.
None are needed once identity is owned by the database.

### Rate limiting

`RATE_LIMITS` in `packages/shared/src/constants/index.ts:20-27` defines proactive per-queue caps.
Those caps require shared cross-instance state, which is what Redis provided.

They are replaced with reactive backoff driven by GitHub's own signal.

```ts
catch (err) {
  if (err.status === 429 || err.status === 403) {
    throw new RetryableError("GitHub rate limited", {
      retryAfter: err.headers?.["retry-after"] ?? "5m",
    })
  }
  throw new FatalError(err.message)
}
```

The proactive caps were set below GitHub's actual budget.
`BRANCH_SYNC` was capped at 30 per minute against an installation limit of 5000 per hour, roughly 83 per minute.
At current traffic these limiters are very unlikely to have ever fired.

Reacting to GitHub's `Retry-After` header responds to the real budget rather than a hardcoded estimate of it, and requires no shared state.
`RATE_LIMITS` and `QUEUE_NAMES` are deleted from `packages/shared`.

### Error handling

| Condition | Behaviour |
| --- | --- |
| GitHub 403 or 429 | `RetryableError` with `retryAfter` from the response header, defaulting to `5m` |
| GitHub 5xx or network failure | `RetryableError` |
| GitHub 4xx other than 403/429 | `FatalError` |
| Missing repository or branch row | `FatalError` |

#### Bug fixed in transit: silent data loss on transient GitHub failure

`apps/worker/src/processors/branch-sync.ts:52-56`:

```ts
} catch (error) {
  console.error(`Failed to fetch branch files: ${error}`)
  changedFiles = []
}
```

Execution then continues unconditionally to delete every `branchFiles` row for the branch and insert the empty list.

A transient GitHub 500 therefore wipes the branch's file index.
The next `detectOverlaps` run finds no files, reports zero overlaps, and marks genuine active overlaps as `resolved`.
Overlaps disappear from the UI with no error surfaced anywhere.

Under the mapping above this throws `RetryableError`, so the delete never executes and the step is retried.

`apps/worker/src/processors/github-feedback.ts:110-113` swallows `createCheckRun` failures in the same shape and receives the same treatment.

### API fold-in

The five Fastify route groups become TanStack Start server routes under `apps/web/src/routes/api/`.

- **Raw body for HMAC.**
  The webhook route calls `await request.text()` before any JSON parsing, so the exact bytes GitHub signed are available to `verifyWebhookSignature`.
  The `addContentTypeParser` workaround in `webhooks.ts:19-26` is removed.

- **CORS deleted.**
  Web and API become same-origin.
  `@fastify/cors` is removed, along with the `VITE_API_URL` and `API_URL` environment variables.
  Session cookies become same-origin, so the `credentials: true` cross-origin handling is no longer needed.

- **Session cookies.**
  `@fastify/cookie`'s `signCookie` and `unsignCookie` are replaced with `jose` JWTs in an httpOnly cookie.
  Existing sessions are invalidated, so every user signs in once more at cutover.
  This was accepted rather than reproducing the `@fastify/cookie` signature format byte for byte, because the domain changes at cutover regardless.

- **Request rate limiting.**
  `@fastify/rate-limit` has no direct replacement and is dropped.
  It used the default in-memory store, so its 100-per-minute cap already applied per instance rather than globally, and was not delivering the guarantee it appeared to.
  Vercel Firewall rate limiting covers this at the edge if needed.
  Recorded here as a deliberate removal rather than an oversight.

### Scheduled work

`apps/api/src/scheduler.ts` and its two BullMQ job schedulers are deleted, replaced by Vercel Cron.

```json
{
  "crons": [
    { "path": "/api/cron/prune-branches", "schedule": "0 */6 * * *" },
    { "path": "/api/cron/cleanup-events", "schedule": "0 3 * * *" }
  ]
}
```

Both endpoints verify the `CRON_SECRET` header before doing anything.

Each endpoint calls `start()` on a workflow rather than performing the work inline.
`pruneStaleBranches` iterates every active repository, so its runtime scales with the number of installations and should not be bounded by a single function invocation.

Vercel Pro supports minute-level cron granularity, so the existing six-hour schedule is preserved exactly.

### Database

A new Supabase project on the existing paid plan.

#### No data is migrated

`prod_dump.sql` is not restored.
The schema is created by running `pnpm db:migrate` against the empty Supabase project, and the application repopulates itself.

This is possible because almost the entire database is a materialized cache of GitHub state rather than authoritative data.

| Table | Rows in prod | Classification |
| --- | --- | --- |
| `webhook_events` | 51 | Audit log, deleted after 7 days by `cleanupOldEvents` |
| `github_app_installations` | 7 | Re-fetched by `syncUserInstallations` on next login |
| `branches` | 3 | Rebuilt by `syncRepository` |
| `branch_files` | 2 | Rebuilt by `syncBranchFiles` |
| `push_subscriptions` | 2 | Authoritative, but re-created by one click per browser |
| `overlaps`, `overlap_files` | 1, 1 | Recomputed from scratch on every `detectOverlaps` run |
| `repositories` | 1 | Rebuilt by `syncRepository` |
| `repository_settings` | 1 | Authoritative, hand-carried if customized from defaults |
| `user_installations` | 1 | Re-fetched by `syncUserInstallations` |
| `users` | 1 | Re-created on next sign-in via GitHub OAuth |
| `organizations`, `pr_alerts`, `pull_requests` | 0 | Empty |

Rebuilding rather than restoring is chosen for three reasons beyond the trivial data volume.

**It reduces the S1 exposure to a hardening task.**
An empty schema behind an exposed Data API is a configuration to fix before data accumulates, rather than a live exposure of production records.
S1 remains required regardless.

**It functionally verifies the migration.**
If a fresh install reconstructs the same repository, branches and overlaps that Railway currently serves, the entire new workflow pipeline has been proven end to end by the act of migrating.
Restoring a dump would demonstrate nothing about whether the workflows execute correctly.

**It does not carry forward known corruption.**
The `branch-sync` defect documented above wipes a branch's file index on any transient GitHub failure, after which `detectOverlaps` marks genuine overlaps as `resolved`.
Production rows may already contain that damage with no record of it.
A dump preserves the damage.
A rebuild from GitHub eliminates it.

Manual carry-over is limited to `repository_settings`, and only if `pruningDays` or `ignoredPaths` were changed from the defaults in `packages/shared/src/constants/index.ts:33-45`.
Check before cutover and re-enter through the UI if so.

`prod_dump.sql` is retained locally as a rollback reference only.
It is already covered by `.gitignore` and must not be committed.

#### Connection configuration

Changes to `packages/db/src/client.ts`:

- `DATABASE_URL` points at the Supavisor transaction pooler on port 6543, not the direct connection.
  Serverless functions open connections per invocation and will exhaust a direct Postgres connection limit.
- The query client is constructed with `prepare: false`.
  Transaction-mode pooling cannot support prepared statements, and `postgres-js` uses them by default.
  Without this the app fails intermittently under concurrency with `prepared statement "s1" already exists`.
- `migrationClient` uses a separate `DIRECT_URL` on port 5432, because migrations require session mode.

### Environment variables

| Variable | Change |
| --- | --- |
| `REDIS_URL` | Removed |
| `API_URL` | Removed, same-origin |
| `VITE_API_URL` | Removed, same-origin |
| `DATABASE_URL` | Repointed to the Neon POOLED endpoint (`-pooler` hostname suffix) |
| `DIRECT_URL` | New, Neon DIRECT endpoint (no `-pooler` suffix), migrations only |
| `CRON_SECRET` | New, guards the two cron endpoints |
| `APP_URL` | Repointed to the Vercel domain |
| `VAPID_SUBJECT` | Repointed off the `.up.railway.app` default in `.env.example` |
| `GITHUB_*` | Unchanged in value, moved to Vercel environment variables |
| `SESSION_SECRET` | Rotated to a new value at cutover, used as the `jose` signing key, see S5 |

## Security

A design-level threat model was run against this plan on 2026-08-12.

Most findings below are not defects in the current code or the proposed code.
They are safety properties that the Railway deployment was providing implicitly, and that this migration retires without any file changing to announce it.
They are recorded here because a diff-based security review of the implementation cannot find them.

### S1. Disable the Supabase Data API for the public schema

**SUPERSEDED by the 2026-08-13 amendment at the top of this document.**
The provider is Neon, which exposes no PostgREST surface, so there is nothing here to close.
The section is kept in full because the reasoning applies again immediately if anyone moves this app to Supabase, and because it records why the risk was considered rather than leaving a future reader to rediscover it.

Railway Postgres is reachable only over the Postgres wire protocol.
A Supabase project additionally exposes PostgREST at `/rest/v1` on the public internet, authenticated by an anon key that is public by design.

Running `pnpm db:migrate` places every table in the `public` schema with no row-level security, because none was ever needed on Railway.
The combination of default grants, an exposed Data API, and no RLS makes `users`, `repositories`, `branches`, `overlaps` and `webhook_events` readable by any holder of the anon key.
`webhook_events` stores complete GitHub payloads, so it is the highest-value target in the database.

Because no data is migrated (see the Database section), the schema is empty at cutover and this is a hardening task rather than a live exposure.
It is still required, and must be done before the application begins repopulating the tables, because the window between first sign-in and remembering to close the Data API is exactly when real data appears.

Required, in order of preference:

1. Disable the Data API for the `public` schema in Supabase project settings
2. Or restore into a schema that is not exposed by PostgREST
3. Or enable RLS on every table with no policies attached, so access fails closed

The application connects directly over the Postgres protocol through Drizzle and never uses PostgREST, so disabling it costs nothing.
This must be verified before the application is pointed at the project, not after.

### S2. Webhook signature verification ordering

See the code block in the idempotency section above.
Verification of the raw request body precedes every database write and every workflow start.
This is a required ordering, not a stylistic preference.

### S3. Rate limiting removal changes the threat economics

On Railway, flooding an endpoint consumed CPU that was already paid for.
On Vercel every request is a billed invocation, so the same flood becomes a direct financial cost.

Exposure, ranked:

- `/api/webhooks/github` is public and unauthenticated, and computes an HMAC on every request before it can reject one.
  A signature cannot be forged, but an attacker can force payment for each failed verification.
- `/api/auth/github/callback` performs an outbound GitHub token exchange per request.
- `/api/push/subscribe` is authenticated but places no bound on subscription rows per user.

Required:

- Vercel Firewall rate limit rules on `/api/webhooks/github` and `/api/auth/*`
- A per-user cap on rows in `push_subscriptions`

### S4. The JWT replaces the signature mechanism, not the session model

The current session cookie carries `{ userId }` and every request re-reads the user from Postgres at `apps/api/src/plugins/auth.ts:51-54`.
Revocation is therefore immediate.
Deleting the user row ends the session on the next request.

Moving to `jose` invites putting profile claims in the token and skipping that lookup.
Doing so trades immediate revocation for a seven-day window in which a deleted user remains authenticated.

Required:

- The token carries `userId` and nothing else
- The per-request database lookup is retained exactly as it is today
- The verification algorithm is pinned explicitly rather than inferred from the token header
- `exp` is set to seven days, matching the current cookie `maxAge`
- `httpOnly: true`, `secure: true` in production, and `sameSite: "lax"` are preserved

### S5. Rotate `SESSION_SECRET` at cutover

Sessions are invalidated by the migration regardless.
Issuing a new secret guarantees that every previously issued cookie fails closed, rather than relying on a format mismatch to reject it.

### S6. `CRON_SECRET` requires a timing-safe comparison

Vercel cron endpoints are publicly routable.
`/api/cron/prune-branches` starts a workflow that iterates every active repository, so an externally triggerable cron endpoint amplifies both cost and database load.

Compare using `crypto.timingSafeEqual` over equal-length buffers.
A `===` comparison leaks the secret through response timing.

### S7. Keep the OAuth state cookie integrity-protected

The `oauth_state` cookie at `apps/api/src/routes/auth.ts:22-30` is currently signed, and the callback validates the unsigned value against the returned `state` parameter.
The replacement must verify integrity, not merely check presence.
A presence-only check reduces the CSRF protection to a value the attacker supplies.

### S8. Do not pass webhook payloads into workflow arguments

`start(processWebhook, [deliveryId])` deliberately passes only an identifier.
Full GitHub payloads, which include repository names, commit messages and author email addresses, stay in Postgres and are never copied into workflow run storage.

This is a privacy property of the design.
Passing the payload directly would be a simplification that widens data residency without any corresponding benefit.

### S9. `/health/ready` must drop its Redis check

`apps/api/src/routes/health.ts:26-31` pings Redis through `fastify.queues`.
After migration that object does not exist, the check throws, and the endpoint returns 503 permanently.
The `redis` key is removed from the checks object.

### Verified clean, and one boundary that is not

- **Repository authorization, route layer.**
  Every `/:id` route calls `requireUser` and then `requireRepoAccess` before reading or writing.
  No insecure direct object references were found at the route layer: a request cannot reach one repository's data by supplying another repository's id.

  This is narrower than "repository authorization" sounds, and the narrowness matters. `requireRepoAccess` (`apps/web/src/lib/repo-access.ts`) scopes access by GitHub App **installation**, not by the requesting user's actual per-repository access on GitHub.
  `syncUserInstallations` (`apps/web/src/lib/github-oauth.ts:3-50`) links a user to an installation as soon as GitHub's `/user/installations` returns it for them, which happens once the user can reach at least one repository inside that installation.
  `applyInstallationRepositories` and `syncInstallation` (`apps/web/src/workflows/steps.ts:450-576`, `578-`) then populate `repositories` rows for **every** repository GitHub reports for that installation, with no per-user filter.

  Failure scenario: an organization installs the GitHub App across the whole org, an engineer has push access to exactly one repository in it, they sign in, and `requireRepoAccess` now passes for every repository in that installation - including `/api/repositories/$id/diffs`, which uses the installation token to fetch full patch content the requesting user was never individually granted access to on GitHub.

  A second gap compounds this: `syncUserInstallations` only inserts and updates `userInstallations` rows; it never removes one. A user removed from an organization, or from just the one repository that originally qualified them for the installation, keeps access until the entire installation is uninstalled from GitHub - there is no re-sync path that revokes a single user's access.

  This is pre-existing behavior, faithfully ported from `apps/api`, not something this migration introduces or worsens. It is recorded here, unfixed, because a diff-based review of the migration would see `requireRepoAccess` called correctly everywhere and conclude the tenant boundary is sound. It is not: the boundary this code actually enforces is per-installation, not per-repository-per-user. Fixing it is a separate decision - it requires either checking live GitHub permissions per request or storing per-user repository grants - and is out of scope here.

- **CSRF exposure after the same-origin fold-in.**
  Removing the CORS boundary retires a control that was gating cross-origin state changes.
  An audit of the route table found every mutation is POST, PATCH or DELETE and every GET is a read.
  With `sameSite: "lax"` preserved, cross-site requests do not carry the session cookie to those methods.
  The residual requirement is narrow: preserve `sameSite: "lax"`, and introduce no state-changing GET routes.

## Cutover plan

Railway stays running and untouched through step 6.
Rollback at any point before step 7 is repointing a single URL.

1. Create the Supabase project.
   Disable the Data API for the `public` schema per S1.
   Run `pnpm db:migrate` to create the schema.
   Restore no data.
   Confirm from outside the network that `/rest/v1` returns no table data when presented with the anon key.
2. Record the current `repository_settings` row from Railway if it differs from the defaults, for manual re-entry later
3. Deploy the migrated code to a Vercel preview deployment
4. Create a second GitHub App pointed at the preview URL
5. Install it on a throwaway repository and verify the full path: push a commit, open a pull request, confirm the check run appears and the push notification arrives
6. Flip the production GitHub App webhook URL and OAuth callback URL to the Vercel domain.
   Both the host and the path change, not only the host: the webhook URL becomes `https://<vercel-domain>/api/webhooks/github` (was `/webhooks/github` on Railway), and the OAuth callback URL becomes `https://<vercel-domain>/api/auth/github/callback` (was `/auth/github/callback` on Railway).
   The callback path matters even if only the host is updated by habit: `apps/web/src/routes/api/auth/github.ts` sends `redirect_uri=<appUrl>/api/auth/github/callback` in the authorize request, so a GitHub App still registered with the old `/auth/github/callback` path produces a `redirect_uri` mismatch and every sign-in fails.
7. Sign in, reinstall the App on the real repository, and confirm the pipeline reconstructs its branches and overlaps.
   Compare against what Railway is still serving.
   This comparison is the acceptance test for the whole migration.
8. Re-enter `repository_settings` if step 2 recorded a difference, and re-enable browser notifications
9. Tear down the Railway project

## Out of scope

- WDK hooks, streams, and `DurableAgent`.
  Nothing in this pipeline waits on human input or a language model.
- Vercel Queues.
  Evaluated and rejected, see the delay-deletion section.
- Any realtime transport.
  The UI keeps its existing React Query `staleTime` polling.
- Any feature work.
  This is a migration.
  The two bug fixes are included only because carrying the bugs across would mean deliberately porting known data-loss behaviour.

## Risks

- **WDK maturity.**
  The largest bet in this design.
  Mitigated by the parallel-run cutover, which keeps Railway serving production until the Vercel path is verified against real deliveries.
- **GitHub webhook timeout.**
  GitHub expects a response within 10 seconds.
  The route only inserts one row and calls `start()`, which returns immediately, so this should be comfortable.
  Cold-start latency must be measured during step 4 of the cutover rather than assumed.
- **`detectOverlaps` runtime.**
  `overlap-detection.ts:73-100` is O(branches x files) within a single step.
  Acceptable at current scale.
  A repository with hundreds of concurrently live branches would require splitting that step, and Fluid Compute's 800-second ceiling is the hard bound.
- **Supabase pooler behaviour under burst.**
  Transaction-mode pooling changes connection semantics.
  The `prepare: false` requirement is the known issue, but pooler limits should be watched during the parallel run.
