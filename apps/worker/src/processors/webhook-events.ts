import type { Job } from 'bullmq'
import { db, webhookEvents, repositories, branches, githubAppInstallations } from '@overlap/db'
import { eq, and } from 'drizzle-orm'
import type { WebhookEventJob, PushEvent, PullRequestEvent, InstallationEvent } from '@overlap/shared'
import { GITHUB_EVENTS, PR_ACTIONS, pushEventSchema, pullRequestEventSchema, installationEventSchema } from '@overlap/shared'
import { extractBranchFromRef, isBranchDeletion, isBranchCreation } from '@overlap/github'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { QUEUE_NAMES } from '@overlap/shared'

// Get queue for adding jobs
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
const branchSyncQueue = new Queue(QUEUE_NAMES.BRANCH_SYNC, { connection })
const overlapDetectionQueue = new Queue(QUEUE_NAMES.OVERLAP_DETECTION, { connection })

export async function webhookEventsProcessor(job: Job<WebhookEventJob>) {
  const { eventType, deliveryId, payload } = job.data

  console.log(`Processing ${eventType} event: ${deliveryId}`)

  try {
    switch (eventType) {
      case GITHUB_EVENTS.PUSH:
        await processPushEvent(payload)
        break

      case GITHUB_EVENTS.PULL_REQUEST:
        await processPullRequestEvent(payload)
        break

      case GITHUB_EVENTS.INSTALLATION:
        await processInstallationEvent(payload)
        break

      case GITHUB_EVENTS.INSTALLATION_REPOSITORIES:
        await processInstallationRepositoriesEvent(payload)
        break

      default:
        console.log(`Unhandled event type: ${eventType}`)
    }

    // Mark event as processed
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(webhookEvents.deliveryId, deliveryId))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    await db
      .update(webhookEvents)
      .set({ error: errorMessage })
      .where(eq(webhookEvents.deliveryId, deliveryId))

    throw error
  }
}

async function processPushEvent(payload: Record<string, unknown>) {
  const parsed = pushEventSchema.parse(payload)
  const branchName = extractBranchFromRef(parsed.ref)

  if (!branchName) {
    console.log(`Ignoring non-branch ref: ${parsed.ref}`)
    return
  }

  // Skip branch deletions (handled synchronously in API)
  if (isBranchDeletion(parsed.after)) {
    return
  }

  // Find the repository
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.githubId, parsed.repository.id),
    with: { installation: true },
  })

  if (!repo) {
    console.log(`Repository not found: ${parsed.repository.full_name}`)
    return
  }

  // Check if this is the default branch
  const isDefault = branchName === repo.defaultBranch

  // Upsert branch
  const existingBranch = await db.query.branches.findFirst({
    where: and(
      eq(branches.repositoryId, repo.id),
      eq(branches.name, branchName)
    ),
  })

  let branchId: string

  if (existingBranch) {
    await db
      .update(branches)
      .set({
        sha: parsed.after,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(branches.id, existingBranch.id))
    branchId = existingBranch.id
  } else {
    const [newBranch] = await db
      .insert(branches)
      .values({
        repositoryId: repo.id,
        name: branchName,
        sha: parsed.after,
        isDefault,
        lastSeenAt: new Date(),
      })
      .returning()
    branchId = newBranch.id
  }

  // Queue branch sync job
  const isForceOrNew = parsed.forced || isBranchCreation(parsed.before)

  await branchSyncQueue.add(
    'sync',
    {
      repositoryId: repo.id,
      branchName,
      sha: parsed.after,
      installationId: repo.installation.installationId,
    },
    {
      jobId: `${repo.id}:${branchName}:${parsed.after}`,
    }
  )

  // Queue overlap detection (skip for default branch)
  if (!isDefault) {
    await overlapDetectionQueue.add(
      'detect',
      {
        repositoryId: repo.id,
        branchId,
        triggeredBy: 'push',
      },
      {
        jobId: `${repo.id}:${branchId}:${Date.now()}`,
        delay: 5000, // Small delay to ensure sync completes first
      }
    )
  }
}

async function processPullRequestEvent(payload: Record<string, unknown>) {
  const parsed = pullRequestEventSchema.parse(payload)

  // Only process relevant actions
  const relevantActions = [PR_ACTIONS.OPENED, PR_ACTIONS.SYNCHRONIZE, PR_ACTIONS.REOPENED]
  if (!relevantActions.includes(parsed.action as typeof PR_ACTIONS.OPENED)) {
    return
  }

  // Find the repository
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.githubId, parsed.repository.id),
  })

  if (!repo) {
    console.log(`Repository not found: ${parsed.repository.full_name}`)
    return
  }

  // Find the branch
  const branch = await db.query.branches.findFirst({
    where: and(
      eq(branches.repositoryId, repo.id),
      eq(branches.name, parsed.pull_request.head.ref)
    ),
  })

  if (!branch) {
    console.log(`Branch not found: ${parsed.pull_request.head.ref}`)
    return
  }

  // Queue overlap detection
  await overlapDetectionQueue.add(
    'detect',
    {
      repositoryId: repo.id,
      branchId: branch.id,
      triggeredBy: 'push',
    },
    {
      jobId: `${repo.id}:${branch.id}:pr:${parsed.number}`,
    }
  )
}

async function processInstallationEvent(payload: Record<string, unknown>) {
  const parsed = installationEventSchema.parse(payload)

  if (parsed.action === 'created') {
    // Create or update installation record
    const accountType = parsed.installation.account.type

    let organizationId: string | null = null
    let userId: string | null = null

    if (accountType === 'Organization') {
      // Upsert organization
      const [org] = await db
        .insert(db._.fullSchema.organizations)
        .values({
          githubId: parsed.installation.account.id,
          name: parsed.installation.account.login,
          avatarUrl: parsed.installation.account.avatar_url,
        })
        .onConflictDoUpdate({
          target: db._.fullSchema.organizations.githubId,
          set: {
            name: parsed.installation.account.login,
            avatarUrl: parsed.installation.account.avatar_url,
            updatedAt: new Date(),
          },
        })
        .returning()
      organizationId = org.id
    }

    // Create installation record
    await db
      .insert(githubAppInstallations)
      .values({
        installationId: parsed.installation.id,
        organizationId,
        userId,
        status: 'active',
      })
      .onConflictDoUpdate({
        target: githubAppInstallations.installationId,
        set: {
          status: 'active',
          updatedAt: new Date(),
        },
      })

    console.log(`Installation created: ${parsed.installation.id}`)
  } else if (parsed.action === 'deleted') {
    // Mark installation as deleted (cascade will handle repos)
    await db
      .update(githubAppInstallations)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(githubAppInstallations.installationId, parsed.installation.id))

    console.log(`Installation deleted: ${parsed.installation.id}`)
  }
}

async function processInstallationRepositoriesEvent(payload: Record<string, unknown>) {
  // Handle repository additions/removals from installation
  const action = payload.action as string
  const installationData = payload.installation as { id: number }

  const installation = await db.query.githubAppInstallations.findFirst({
    where: eq(githubAppInstallations.installationId, installationData.id),
  })

  if (!installation) {
    console.log(`Installation not found: ${installationData.id}`)
    return
  }

  if (action === 'added') {
    const repos = payload.repositories_added as Array<{
      id: number
      name: string
      full_name: string
      private: boolean
    }>

    for (const repo of repos) {
      await db
        .insert(repositories)
        .values({
          githubId: repo.id,
          installationId: installation.id,
          name: repo.name,
          fullName: repo.full_name,
          isPrivate: repo.private,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: repositories.githubId,
          set: {
            isActive: true,
            updatedAt: new Date(),
          },
        })
    }
  } else if (action === 'removed') {
    const repos = payload.repositories_removed as Array<{ id: number }>

    for (const repo of repos) {
      await db
        .update(repositories)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(repositories.githubId, repo.id))
    }
  }
}
