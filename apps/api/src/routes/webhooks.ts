import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { verifyWebhookSignature, extractBranchFromRef, isBranchDeletion } from '@overlap/github'
import { db, webhookEvents, repositories, branches, branchFiles } from '@overlap/db'
import { eq, and } from 'drizzle-orm'
import { GITHUB_EVENTS, PR_ACTIONS } from '@overlap/shared'
import { addWebhookEventJob } from '../queues/index.js'

interface WebhookHeaders {
  'x-github-event': string
  'x-github-delivery': string
  'x-hub-signature-256': string
}

export async function webhooksRoute(fastify: FastifyInstance) {
  // Disable body parsing to get raw body for signature verification
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      done(null, body)
    }
  )

  fastify.post<{
    Headers: WebhookHeaders
    Body: string
  }>('/github', async (request, reply) => {
    const signature = request.headers['x-hub-signature-256']
    const event = request.headers['x-github-event']
    const deliveryId = request.headers['x-github-delivery']

    // Verify webhook secret
    const secret = process.env.GITHUB_WEBHOOK_SECRET
    if (!secret) {
      fastify.log.error('GITHUB_WEBHOOK_SECRET not configured')
      return reply.status(500).send({ error: 'Server configuration error' })
    }

    const verification = verifyWebhookSignature(request.body, signature, secret)
    if (!verification.valid) {
      fastify.log.warn(`Invalid webhook signature: ${verification.error}`)
      return reply.status(401).send({ error: 'Invalid signature' })
    }

    // Parse payload
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(request.body)
    } catch {
      return reply.status(400).send({ error: 'Invalid JSON payload' })
    }

    // Get repository ID if available
    let repositoryId: string | null = null
    const repoData = payload.repository as { id?: number } | undefined
    if (repoData?.id) {
      const repo = await db.query.repositories.findFirst({
        where: eq(repositories.githubId, repoData.id),
      })
      repositoryId = repo?.id ?? null
    }

    // Store webhook event
    await db.insert(webhookEvents).values({
      eventType: event,
      deliveryId,
      repositoryId,
      payload,
    })

    // Handle specific events
    switch (event) {
      case GITHUB_EVENTS.PUSH:
        await handlePushEvent(fastify, payload, deliveryId)
        break

      case GITHUB_EVENTS.PULL_REQUEST:
        await handlePullRequestEvent(fastify, payload, deliveryId)
        break

      case GITHUB_EVENTS.INSTALLATION:
      case GITHUB_EVENTS.INSTALLATION_REPOSITORIES:
        await handleInstallationEvent(fastify, payload, deliveryId)
        break

      default:
        fastify.log.info(`Ignoring unhandled event: ${event}`)
    }

    // Add to queue for processing
    await addWebhookEventJob(fastify.queues, {
      eventType: event,
      deliveryId,
      payload,
    })

    return reply.status(200).send({ received: true })
  })
}

async function handlePushEvent(
  fastify: FastifyInstance,
  payload: Record<string, unknown>,
  deliveryId: string
) {
  const ref = payload.ref as string
  const after = payload.after as string
  const repository = payload.repository as { id: number; full_name: string }

  const branchName = extractBranchFromRef(ref)
  if (!branchName) {
    fastify.log.info(`Ignoring non-branch ref: ${ref}`)
    return
  }

  // Check if branch was deleted
  if (isBranchDeletion(after)) {
    fastify.log.info(`Branch deleted: ${branchName} in ${repository.full_name}`)

    // Find and clean up the branch
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.githubId, repository.id),
    })

    if (repo) {
      const branch = await db.query.branches.findFirst({
        where: and(
          eq(branches.repositoryId, repo.id),
          eq(branches.name, branchName)
        ),
      })

      if (branch) {
        // Delete branch files first (cascade should handle this but being explicit)
        await db.delete(branchFiles).where(eq(branchFiles.branchId, branch.id))
        await db.delete(branches).where(eq(branches.id, branch.id))
        fastify.log.info(`Cleaned up deleted branch: ${branchName}`)
      }
    }
    return
  }

  fastify.log.info(`Push to ${branchName} in ${repository.full_name}`)
}

async function handlePullRequestEvent(
  fastify: FastifyInstance,
  payload: Record<string, unknown>,
  deliveryId: string
) {
  const action = payload.action as string
  const prData = payload.pull_request as {
    number: number
    title: string
    head: { ref: string }
  }

  // Only process relevant actions
  const relevantActions = [PR_ACTIONS.OPENED, PR_ACTIONS.SYNCHRONIZE, PR_ACTIONS.REOPENED]
  if (!relevantActions.includes(action as typeof PR_ACTIONS.OPENED)) {
    fastify.log.info(`Ignoring PR action: ${action}`)
    return
  }

  fastify.log.info(`PR ${action}: #${prData.number} (${prData.head.ref})`)
}

async function handleInstallationEvent(
  fastify: FastifyInstance,
  payload: Record<string, unknown>,
  deliveryId: string
) {
  const action = payload.action as string
  const installation = payload.installation as { id: number; account: { login: string } }

  fastify.log.info(
    `Installation ${action}: ${installation.id} for ${installation.account.login}`
  )
}
