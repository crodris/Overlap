import type { Job } from 'bullmq'
import { db, branches, branchFiles, overlaps, overlapFiles, repositories, repositorySettings, pullRequests } from '@overlap/db'
import { eq, and, ne, sql, inArray, gt } from 'drizzle-orm'
import type { OverlapDetectionJob } from '@overlap/shared'
import { calculateSeverity, DEFAULT_SETTINGS, QUEUE_NAMES } from '@overlap/shared'
import { Queue } from 'bullmq'
import { Redis } from 'ioredis'

// Get queues for adding feedback and notification jobs
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
const githubFeedbackQueue = new Queue(QUEUE_NAMES.GITHUB_FEEDBACK, { connection })
const pushNotificationQueue = new Queue(QUEUE_NAMES.PUSH_NOTIFICATION, { connection })

export async function overlapDetectionProcessor(job: Job<OverlapDetectionJob>) {
  const { repositoryId, branchId, triggeredBy } = job.data

  console.log(`Detecting overlaps for branch: ${branchId} (triggered by: ${triggeredBy})`)

  // Get the branch and its files
  const branch = await db.query.branches.findFirst({
    where: eq(branches.id, branchId),
    with: { files: true, repository: { with: { settings: true } } },
  })

  if (!branch) {
    throw new Error(`Branch not found: ${branchId}`)
  }

  // Skip if this is the default branch
  if (branch.isDefault) {
    console.log('Skipping default branch')
    return { overlapsFound: 0 }
  }

  // Skip if branch has no files
  if (branch.files.length === 0) {
    console.log('Branch has no tracked files')
    return { overlapsFound: 0 }
  }

  // Get settings
  const pruningDays = branch.repository.settings?.pruningDays ?? DEFAULT_SETTINGS.PRUNING_DAYS

  // Calculate stale date threshold
  const staleDate = new Date()
  staleDate.setDate(staleDate.getDate() - pruningDays)

  // Get all other active branches in the same repository
  const otherBranches = await db.query.branches.findMany({
    where: and(
      eq(branches.repositoryId, repositoryId),
      ne(branches.id, branchId),
      eq(branches.isDefault, false),
      gt(branches.lastSeenAt, staleDate)
    ),
    with: { files: true },
  })

  console.log(`Comparing against ${otherBranches.length} other branches`)

  const branchFilePaths = new Set(branch.files.map((f) => f.filePath))
  const detectedOverlaps: Array<{
    targetBranchId: string
    files: Array<{
      filePath: string
      sourceChangeType: string
      targetChangeType: string
    }>
  }> = []

  // Find overlapping files with each other branch
  for (const otherBranch of otherBranches) {
    const overlappingFiles: Array<{
      filePath: string
      sourceChangeType: string
      targetChangeType: string
    }> = []

    for (const otherFile of otherBranch.files) {
      if (branchFilePaths.has(otherFile.filePath)) {
        const sourceFile = branch.files.find((f) => f.filePath === otherFile.filePath)
        if (sourceFile) {
          overlappingFiles.push({
            filePath: otherFile.filePath,
            sourceChangeType: sourceFile.changeType,
            targetChangeType: otherFile.changeType,
          })
        }
      }
    }

    if (overlappingFiles.length > 0) {
      detectedOverlaps.push({
        targetBranchId: otherBranch.id,
        files: overlappingFiles,
      })
    }
  }

  console.log(`Found ${detectedOverlaps.length} overlapping branches`)

  // Process each detected overlap
  for (const detected of detectedOverlaps) {
    const severity = calculateSeverity(detected.files.length)

    // Check if overlap already exists (in either direction)
    const existingOverlap = await db.query.overlaps.findFirst({
      where: sql`
        ${overlaps.repositoryId} = ${repositoryId}
        AND (
          (${overlaps.sourceBranchId} = ${branchId} AND ${overlaps.targetBranchId} = ${detected.targetBranchId})
          OR (${overlaps.sourceBranchId} = ${detected.targetBranchId} AND ${overlaps.targetBranchId} = ${branchId})
        )
      `,
    })

    let overlapId: string
    let isNew = false
    let severityIncreased = false
    let wasReactivated = false

    if (existingOverlap) {
      // Update existing overlap
      const oldSeverity = existingOverlap.severity
      severityIncreased = compareSeverity(severity, oldSeverity as typeof severity) > 0
      wasReactivated = existingOverlap.status === 'resolved' || existingOverlap.status === 'ignored'

      await db
        .update(overlaps)
        .set({
          fileCount: detected.files.length,
          severity,
          status: 'active',
          resolvedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(overlaps.id, existingOverlap.id))

      overlapId = existingOverlap.id

      // Delete old overlap files and insert new ones
      await db.delete(overlapFiles).where(eq(overlapFiles.overlapId, overlapId))
    } else {
      // Create new overlap
      isNew = true
      const [newOverlap] = await db
        .insert(overlaps)
        .values({
          repositoryId,
          sourceBranchId: branchId,
          targetBranchId: detected.targetBranchId,
          fileCount: detected.files.length,
          severity,
          status: 'active',
          detectedAt: new Date(),
        })
        .returning()

      overlapId = newOverlap.id
    }

    // Insert overlap files
    await db.insert(overlapFiles).values(
      detected.files.map((f) => ({
        overlapId,
        filePath: f.filePath,
        sourceChangeType: f.sourceChangeType,
        targetChangeType: f.targetChangeType,
      }))
    )

    // Check if we should send notifications
    // Notify on: new overlaps, severity increases, or reactivated overlaps
    // (previously resolved/ignored but the file was edited again)
    const shouldNotify =
      (isNew && branch.repository.settings?.notifyOnNewOverlap !== false) ||
      (severityIncreased && branch.repository.settings?.notifyOnSeverityIncrease !== false) ||
      wasReactivated

    if (shouldNotify) {
      // Use a timestamp suffix so reactivated overlaps aren't deduplicated by BullMQ
      const jobSuffix = wasReactivated ? `-${Date.now()}` : ''

      // Find any open PRs for this branch
      const openPRs = await db.query.pullRequests.findMany({
        where: and(
          eq(pullRequests.branchId, branchId),
          eq(pullRequests.state, 'open')
        ),
      })

      for (const pr of openPRs) {
        await githubFeedbackQueue.add(
          'feedback',
          {
            repositoryId,
            pullRequestId: pr.id,
            overlapId,
            alertType: 'check_run',
          },
          {
            jobId: `${pr.id}-${overlapId}${jobSuffix}`,
          }
        )
      }

      // Send push notification to the developer on the OTHER branch
      // If A pushed and overlaps with B, notify B's developer
      await pushNotificationQueue.add(
        'notify',
        {
          repositoryId,
          overlapId,
          targetBranchId: detected.targetBranchId,
        },
        {
          jobId: `push-${overlapId}-${detected.targetBranchId}${jobSuffix}`,
        }
      )
    }
  }

  // Check for resolved overlaps (overlaps that no longer have overlapping files)
  const currentOverlaps = await db.query.overlaps.findMany({
    where: and(
      eq(overlaps.repositoryId, repositoryId),
      sql`(${overlaps.sourceBranchId} = ${branchId} OR ${overlaps.targetBranchId} = ${branchId})`,
      eq(overlaps.status, 'active')
    ),
  })

  const activeTargetIds = new Set(detectedOverlaps.map((o) => o.targetBranchId))

  for (const overlap of currentOverlaps) {
    const otherBranchId =
      overlap.sourceBranchId === branchId ? overlap.targetBranchId : overlap.sourceBranchId

    if (!activeTargetIds.has(otherBranchId)) {
      // This overlap is no longer active
      await db
        .update(overlaps)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(overlaps.id, overlap.id))

      console.log(`Overlap resolved: ${overlap.id}`)
    }
  }

  return { overlapsFound: detectedOverlaps.length }
}

function compareSeverity(
  a: 'low' | 'medium' | 'high' | 'critical',
  b: 'low' | 'medium' | 'high' | 'critical'
): number {
  const order = { low: 0, medium: 1, high: 2, critical: 3 }
  return order[a] - order[b]
}
