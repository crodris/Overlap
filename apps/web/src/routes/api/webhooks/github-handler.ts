/**
 * Ported from apps/api/src/routes/webhooks.ts.
 *
 * Spec S2 makes the ordering here a security requirement: HMAC verification
 * of the raw request body must precede every database write and every
 * workflow start. Get this wrong and the endpoint becomes a public
 * unauthenticated write that inserts attacker-controlled JSON into
 * `webhook_events` and starts a billed workflow run per request.
 *
 * `start` is an injected dependency (see `Deps`) rather than imported
 * directly, which is what makes the ordering testable without a running
 * workflow runtime - see `__tests__/verify-order.test.ts`.
 *
 * Deduplication moved off BullMQ's `jobId`, which lived in Redis and expired
 * on a TTL, onto the unique constraint on `webhook_events.deliveryId`, which
 * is durable in Postgres. `.onConflictDoNothing().returning()` returns no row
 * when the delivery is a GitHub redelivery of a `deliveryId` already stored.
 * That is not the same as "already handled" or "safe to ignore": a stored
 * row can be in one of four states by the time a redelivery arrives, and
 * `dispatchedAt` (set only after `deps.start` has actually returned) is what
 * distinguishes them:
 *
 *  - `dispatchedAt` null: either the process died between the insert and the
 *    start, or `deps.start` itself threw. No run exists. Redeliver -> start.
 *  - `dispatchedAt` set, `error` null, `processedAt` null: a run exists and
 *    is still in flight. Redeliver -> do nothing; starting a second run here
 *    would produce the exact duplicate-check-run / duplicate-push-
 *    notification bug this table's unique constraint exists to prevent.
 *  - `error` set, `processedAt` null: the run terminally failed (see
 *    `markEventProcessed` in `apps/web/src/workflows/steps.ts`, which sets
 *    `error` but never `processedAt` on the failure path). Redeliver ->
 *    start again; this is the whole point of making redelivery curative.
 *  - `processedAt` set: finished. Redeliver -> do nothing.
 *
 * The original handler also ran branch-deletion cleanup (deleting the
 * `branches` / `branch_files` rows) inline, synchronously, before enqueuing.
 * That logic now lives in the `upsertBranch` workflow step
 * (`apps/web/src/workflows/steps.ts`) instead of here: it is a database
 * write driven by webhook payload data, so it belongs in the durable,
 * retryable workflow rather than in the thin, unauthenticated-until-verified
 * route handler. Duplicating it here would mean running it twice per
 * delivery for no benefit, and would reintroduce a database write that is
 * not retried if it fails.
 */
import { verifyWebhookSignature } from '@overlap/github'
import { db, webhookEvents, repositories } from '@overlap/db'
import { eq } from 'drizzle-orm'
import { processWebhook } from '../../../workflows/process-webhook'

type Deps = { start: (wf: unknown, args: unknown[]) => Promise<unknown> }

export async function handleWebhook(request: Request, deps: Deps): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
    })
  }

  // Raw bytes, before any parsing. This is what GitHub signed.
  const raw = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  const eventType = request.headers.get('x-github-event') ?? ''
  const deliveryId = request.headers.get('x-github-delivery') ?? ''

  // Nothing below this line may execute for an unverified request.
  const verification = verifyWebhookSignature(raw, signature, secret)
  if (!verification.valid) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
    })
  }

  // A delivery with no id can never be deduplicated: every future delivery
  // that is also missing the header would collide with this one on the
  // empty string and be silently swallowed as a "redelivery" forever.
  if (!deliveryId) {
    return new Response(JSON.stringify({ error: 'Missing delivery id' }), {
      status: 400,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
    })
  }

  // Valid JSON can be null, a number, a string, or a boolean, none of which
  // has a `.repository` property to read below. `typeof null === 'object'`,
  // so it needs its own check.
  if (typeof parsed !== 'object' || parsed === null) {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
    })
  }

  const payload = parsed as Record<string, unknown>

  let repositoryId: string | null = null
  const repoData = payload.repository as { id?: number } | undefined
  if (repoData?.id) {
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.githubId, repoData.id),
    })
    repositoryId = repo?.id ?? null
  }

  const [row] = await db
    .insert(webhookEvents)
    .values({ eventType, deliveryId, repositoryId, payload })
    .onConflictDoNothing()
    .returning()

  if (row) {
    await deps.start(processWebhook, [deliveryId])
    // Only recorded once deps.start has actually returned: if it throws,
    // dispatchedAt stays null and a later redelivery will retry the
    // dispatch instead of finding a row that looks like it already has a
    // run and skipping it forever.
    await db
      .update(webhookEvents)
      .set({ dispatchedAt: new Date() })
      .where(eq(webhookEvents.deliveryId, deliveryId))
    return new Response(JSON.stringify({ received: true }), { status: 200 })
  }

  // No row means the unique constraint on deliveryId rejected the insert:
  // this deliveryId was already stored. See the four states documented
  // above; only the first two ever justify starting a workflow again.
  const existing = await db.query.webhookEvents.findFirst({
    where: eq(webhookEvents.deliveryId, deliveryId),
  })

  const shouldRedispatch =
    !!existing && (!existing.dispatchedAt || (!!existing.error && !existing.processedAt))

  if (shouldRedispatch) {
    await deps.start(processWebhook, [deliveryId])
    await db
      .update(webhookEvents)
      .set({ dispatchedAt: new Date() })
      .where(eq(webhookEvents.deliveryId, deliveryId))
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 })
}
