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
 * when the delivery is a GitHub redelivery that was already accepted, and the
 * handler returns 200 without starting a second workflow run.
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

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
    })
  }

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

  // No row means GitHub redelivered a delivery we already accepted.
  if (!row) {
    return new Response(JSON.stringify({ received: true }), { status: 200 })
  }

  await deps.start(processWebhook, [deliveryId])

  return new Response(JSON.stringify({ received: true }), { status: 200 })
}
