# Vercel Migration Design

Date: 2026-08-12
Status: Approved, pending implementation plan

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

```ts
const [row] = await db.insert(webhookEvents)
  .values({ deliveryId, eventType, payload, repositoryId })
  .onConflictDoNothing()
  .returning()

if (!row) return Response.json({ received: true })   // GitHub redelivery

await start(processWebhook, [deliveryId])
```

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
`prod_dump.sql` provides the migration path.

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
| `DATABASE_URL` | Repointed to Supabase Supavisor pooler, port 6543 |
| `DIRECT_URL` | New, Supabase direct connection, port 5432, migrations only |
| `CRON_SECRET` | New, guards the two cron endpoints |
| `APP_URL` | Repointed to the Vercel domain |
| `VAPID_SUBJECT` | Repointed off the `.up.railway.app` default in `.env.example` |
| `GITHUB_*` | Unchanged in value, moved to Vercel environment variables |
| `SESSION_SECRET` | Unchanged in value, now used as the `jose` signing key |

## Cutover plan

Railway stays running and untouched through step 6.
Rollback at any point before step 7 is repointing a single URL.

1. Create the Supabase project, restore `prod_dump.sql`, verify row counts against production
2. Deploy the migrated code to a Vercel preview deployment
3. Create a second GitHub App pointed at the preview URL
4. Install it on a throwaway repository and verify the full path: push a commit, open a pull request, confirm the check run appears and the push notification arrives
5. Flip the production GitHub App webhook URL and OAuth callback URL to the Vercel domain
6. Observe a real production delivery complete end to end
7. Tear down the Railway project

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
