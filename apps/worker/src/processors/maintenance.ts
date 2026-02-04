import type { Job } from 'bullmq'
import { db, branches, branchFiles, overlaps, webhookEvents, repositories, repositorySettings } from '@overlap/db'
import { eq, and, lt, inArray, sql } from 'drizzle-orm'
import type { MaintenanceJob } from '@overlap/shared'
import { DEFAULT_SETTINGS } from '@overlap/shared'
import { getGitHubClient } from '@overlap/github'

export async function maintenanceProcessor(job: Job<MaintenanceJob>) {
  const { type, repositoryId } = job.data

  console.log(`Running maintenance task: ${type}${repositoryId ? ` for ${repositoryId}` : ''}`)

  switch (type) {
    case 'prune_branches':
      return await pruneStaleBranches(repositoryId)

    case 'cleanup_events':
      return await cleanupOldEvents()

    case 'sync_repository':
      if (!repositoryId) {
        throw new Error('repositoryId required for sync_repository')
      }
      return await syncRepository(repositoryId)

    default:
      throw new Error(`Unknown maintenance type: ${type}`)
  }
}

async function pruneStaleBranches(repositoryId?: string) {
  let prunedCount = 0

  // Get repositories to process
  const repos = repositoryId
    ? await db.query.repositories.findMany({
        where: eq(repositories.id, repositoryId),
        with: { settings: true },
      })
    : await db.query.repositories.findMany({
        where: eq(repositories.isActive, true),
        with: { settings: true },
      })

  for (const repo of repos) {
    const pruningDays = repo.settings?.pruningDays ?? DEFAULT_SETTINGS.PRUNING_DAYS
    const staleDate = new Date()
    staleDate.setDate(staleDate.getDate() - pruningDays)

    // Find stale branches (non-default, not seen recently)
    const staleBranches = await db.query.branches.findMany({
      where: and(
        eq(branches.repositoryId, repo.id),
        eq(branches.isDefault, false),
        lt(branches.lastSeenAt, staleDate)
      ),
    })

    if (staleBranches.length === 0) continue

    const staleBranchIds = staleBranches.map((b) => b.id)

    // Delete branch files
    await db.delete(branchFiles).where(inArray(branchFiles.branchId, staleBranchIds))

    // Update overlaps involving these branches to resolved
    await db
      .update(overlaps)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        sql`(${overlaps.sourceBranchId} IN (${sql.join(staleBranchIds, sql`, `)}) OR ${overlaps.targetBranchId} IN (${sql.join(staleBranchIds, sql`, `)}))`
      )

    // Delete the branches
    await db.delete(branches).where(inArray(branches.id, staleBranchIds))

    prunedCount += staleBranches.length
    console.log(`Pruned ${staleBranches.length} stale branches from ${repo.fullName}`)
  }

  return { prunedBranches: prunedCount }
}

async function cleanupOldEvents() {
  // Delete webhook events older than 7 days
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - 7)

  const result = await db
    .delete(webhookEvents)
    .where(lt(webhookEvents.createdAt, cutoffDate))

  console.log(`Cleaned up old webhook events`)
  return { cleaned: true }
}

async function syncRepository(repositoryId: string) {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: { installation: true },
  })

  if (!repo) {
    throw new Error(`Repository not found: ${repositoryId}`)
  }

  const github = getGitHubClient()
  const [owner, repoName] = repo.fullName.split('/')

  // Fetch all branches from GitHub
  const remoteBranches = await github.getBranches(
    repo.installation.installationId,
    owner,
    repoName
  )

  // Get current local branches
  const localBranches = await db.query.branches.findMany({
    where: eq(branches.repositoryId, repositoryId),
  })

  const localBranchMap = new Map(localBranches.map((b) => [b.name, b]))
  const remoteBranchNames = new Set(remoteBranches.map((b) => b.name))

  // Find branches to add or update
  let addedCount = 0
  let updatedCount = 0

  for (const remote of remoteBranches) {
    const local = localBranchMap.get(remote.name)
    const isDefault = remote.name === repo.defaultBranch

    if (local) {
      // Update if SHA changed
      if (local.sha !== remote.sha) {
        await db
          .update(branches)
          .set({
            sha: remote.sha,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(branches.id, local.id))
        updatedCount++
      }
    } else {
      // Add new branch
      await db.insert(branches).values({
        repositoryId,
        name: remote.name,
        sha: remote.sha,
        isDefault,
        lastSeenAt: new Date(),
      })
      addedCount++
    }
  }

  // Find branches that no longer exist on remote
  const deletedCount = localBranches.filter(
    (b) => !remoteBranchNames.has(b.name)
  ).length

  // Mark missing branches as stale (they'll be pruned later)
  for (const local of localBranches) {
    if (!remoteBranchNames.has(local.name)) {
      await db
        .update(branches)
        .set({
          lastSeenAt: new Date(0), // Epoch = very old
          updatedAt: new Date(),
        })
        .where(eq(branches.id, local.id))
    }
  }

  // Update repo sync timestamp
  await db
    .update(repositories)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(repositories.id, repositoryId))

  console.log(`Synced repository: added ${addedCount}, updated ${updatedCount}, marked ${deletedCount} for deletion`)

  return { added: addedCount, updated: updatedCount, markedForDeletion: deletedCount }
}
