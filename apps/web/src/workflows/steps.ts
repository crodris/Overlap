/**
 * Workflow steps.
 *
 * These are ports of the six BullMQ processors that used to live in
 * `apps/worker/src/processors/`. Three things changed in the port:
 *
 *  1. The `Job<T>` parameter became plain arguments.
 *  2. Every `Queue` / `Redis` / `queue.add(...)` reference is gone. Steps no
 *     longer chain each other; a workflow function sequences them. Where a
 *     processor used to enqueue follow-on work it now returns the data the
 *     workflow needs to do the sequencing itself.
 *  3. GitHub failures are classified into FatalError / RetryableError instead
 *     of being swallowed.
 *
 * Steps run in full Node.js. Only the workflow function is sandboxed.
 */

import {
  branchFiles,
  branches,
  db,
  githubAppInstallations,
  organizations,
  overlapFiles,
  overlaps,
  prAlerts,
  pullRequests,
  pushSubscriptions,
  repositories,
  userInstallations,
  users,
  webhookEvents,
} from '@overlap/db'
import { and, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm'
import {
  DEFAULT_SETTINGS,
  GITHUB_EVENTS,
  PR_ACTIONS,
  calculateSeverity,
  installationEventSchema,
  pullRequestEventSchema,
  pushEventSchema,
} from '@overlap/shared'
import {
  extractBranchFromRef,
  formatCheckRunSummary,
  getGitHubClient,
  isBranchDeletion,
  type CommitFile,
} from '@overlap/github'
import { FatalError } from 'workflow'
import { minimatch } from 'minimatch'
import webpush from 'web-push'
import { classifyGitHubError } from './errors'

// ============================================================================
// Types
// ============================================================================

/**
 * A webhook delivery resolved into the shape the workflow branches on.
 * `installation_repositories` deliveries are reported as `installation`
 * because `syncInstallation` handles both.
 */
export type LoadedEvent =
  | {
      type: 'push'
      deliveryId: string
      eventType: string
      /** Branch name extracted from the ref, or null for non-branch refs. */
      branchName: string | null
      sha: string
      /** True when the push deleted the branch. */
      isDeletion: boolean
    }
  | {
      type: 'pull_request'
      deliveryId: string
      eventType: string
      action: string
      /** False for actions the pipeline ignores. */
      isRelevant: boolean
    }
  | {
      type: 'installation'
      deliveryId: string
      eventType: string
      action: string
    }
  | {
      type: 'unhandled'
      deliveryId: string
      eventType: string
    }

/**
 * Work that `detectOverlaps` used to enqueue and now hands back to the
 * workflow: one entry per overlap that warrants a notification.
 */
export type NotificationTarget = {
  repositoryId: string
  overlapId: string
  targetBranchId: string
  pullRequestIds: string[]
}

type Severity = 'low' | 'medium' | 'high' | 'critical'

// ============================================================================
// Internal helpers (plain functions, called from inside steps)
// ============================================================================

async function loadEventRow(deliveryId: string) {
  const event = await db.query.webhookEvents.findFirst({
    where: eq(webhookEvents.deliveryId, deliveryId),
  })

  if (!event) {
    throw new FatalError(`Webhook event not found: ${deliveryId}`)
  }

  return event
}

/**
 * A payload that does not match its schema will never match it on a retry,
 * so parse failures are fatal.
 */
function parsePayload<T>(
  schema: { parse: (value: unknown) => T },
  payload: unknown,
  deliveryId: string
): T {
  try {
    return schema.parse(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new FatalError(
      `Malformed webhook payload for delivery ${deliveryId}: ${message}`
    )
  }
}

function mapChangeType(
  status: string
): 'added' | 'modified' | 'deleted' | 'renamed' {
  switch (status) {
    case 'added':
      return 'added'
    case 'removed':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    default:
      return 'modified'
  }
}

function compareSeverity(a: Severity, b: Severity): number {
  const order = { low: 0, medium: 1, high: 2, critical: 3 }
  return order[a] - order[b]
}

// ============================================================================
// Webhook events (from processors/webhook-events.ts)
// ============================================================================

/**
 * Resolves a stored webhook delivery into a discriminated union the workflow
 * can branch on.
 */
export async function loadEvent(deliveryId: string): Promise<LoadedEvent> {
  'use step'

  const event = await loadEventRow(deliveryId)
  const eventType = event.eventType

  switch (eventType) {
    case GITHUB_EVENTS.PUSH: {
      const parsed = parsePayload(pushEventSchema, event.payload, deliveryId)
      return {
        type: 'push',
        deliveryId,
        eventType,
        branchName: extractBranchFromRef(parsed.ref),
        sha: parsed.after,
        isDeletion: isBranchDeletion(parsed.after),
      }
    }

    case GITHUB_EVENTS.PULL_REQUEST: {
      const parsed = parsePayload(
        pullRequestEventSchema,
        event.payload,
        deliveryId
      )
      const relevantActions: string[] = [
        PR_ACTIONS.OPENED,
        PR_ACTIONS.SYNCHRONIZE,
        PR_ACTIONS.REOPENED,
        PR_ACTIONS.CLOSED,
      ]
      return {
        type: 'pull_request',
        deliveryId,
        eventType,
        action: parsed.action,
        isRelevant: relevantActions.includes(parsed.action),
      }
    }

    case GITHUB_EVENTS.INSTALLATION:
    case GITHUB_EVENTS.INSTALLATION_REPOSITORIES: {
      const payload = event.payload as { action?: string }
      return {
        type: 'installation',
        deliveryId,
        eventType,
        action: payload.action ?? '',
      }
    }

    default:
      return { type: 'unhandled', deliveryId, eventType }
  }
}

/**
 * Records the outcome of a delivery. The processor did this in a try/catch
 * around the whole job; the workflow now decides when to call it.
 */
export async function markEventProcessed(
  deliveryId: string,
  error?: string
): Promise<{ deliveryId: string }> {
  'use step'

  await db
    .update(webhookEvents)
    .set(error ? { error } : { processedAt: new Date() })
    .where(eq(webhookEvents.deliveryId, deliveryId))

  return { deliveryId }
}

/**
 * Upserts the branch a push touched. Returns null when there is nothing to
 * sync: a non-branch ref, a branch deletion, or an unknown repository.
 *
 * The processor enqueued branch-sync and (for non-default branches) overlap
 * detection here. Both are now the workflow's job, which is what `isDefault`
 * and the branch identifiers in the return value are for.
 */
export async function upsertBranch(deliveryId: string): Promise<{
  branchId: string
  repositoryId: string
  installationId: number
  branchName: string
  sha: string
  isDefault: boolean
} | null> {
  'use step'

  const event = await loadEventRow(deliveryId)
  const parsed = parsePayload(pushEventSchema, event.payload, deliveryId)
  const branchName = extractBranchFromRef(parsed.ref)

  if (!branchName) {
    console.log(`Ignoring non-branch ref: ${parsed.ref}`)
    return null
  }

  // Skip branch deletions (handled synchronously when the webhook arrives)
  if (isBranchDeletion(parsed.after)) {
    return null
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.githubId, parsed.repository.id),
    with: { installation: true },
  })

  if (!repo) {
    console.log(`Repository not found: ${parsed.repository.full_name}`)
    return null
  }

  const isDefault = branchName === repo.defaultBranch

  const existingBranch = await db.query.branches.findFirst({
    where: and(eq(branches.repositoryId, repo.id), eq(branches.name, branchName)),
  })

  let branchId: string

  if (existingBranch) {
    await db
      .update(branches)
      .set({
        sha: parsed.after,
        lastPusherGithubId: parsed.sender.id,
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
        lastPusherGithubId: parsed.sender.id,
        lastSeenAt: new Date(),
      })
      .returning()
    branchId = newBranch.id
  }

  return {
    branchId,
    repositoryId: repo.id,
    installationId: repo.installation.installationId,
    branchName,
    sha: parsed.after,
    isDefault,
  }
}

/**
 * Upserts the pull request a `pull_request` delivery describes. Returns null
 * when nothing downstream should run: an ignored action, an unknown
 * repository or branch, or a closed PR (the record is still updated, but the
 * processor did not run detection for closed PRs and neither do we).
 */
export async function upsertPullRequest(
  deliveryId: string
): Promise<{ repositoryId: string; branchId: string } | null> {
  'use step'

  const event = await loadEventRow(deliveryId)
  const parsed = parsePayload(pullRequestEventSchema, event.payload, deliveryId)

  const relevantActions: string[] = [
    PR_ACTIONS.OPENED,
    PR_ACTIONS.SYNCHRONIZE,
    PR_ACTIONS.REOPENED,
    PR_ACTIONS.CLOSED,
  ]
  if (!relevantActions.includes(parsed.action)) {
    return null
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.githubId, parsed.repository.id),
  })

  if (!repo) {
    console.log(`Repository not found: ${parsed.repository.full_name}`)
    return null
  }

  const branch = await db.query.branches.findFirst({
    where: and(
      eq(branches.repositoryId, repo.id),
      eq(branches.name, parsed.pull_request.head.ref)
    ),
  })

  if (!branch) {
    console.log(`Branch not found: ${parsed.pull_request.head.ref}`)
    return null
  }

  let prState: 'open' | 'closed' | 'merged' = parsed.pull_request.state
  if (parsed.action === PR_ACTIONS.CLOSED && parsed.pull_request.merged) {
    prState = 'merged'
  }

  await db
    .insert(pullRequests)
    .values({
      repositoryId: repo.id,
      branchId: branch.id,
      githubPrNumber: parsed.pull_request.number,
      title: parsed.pull_request.title,
      state: prState,
    })
    .onConflictDoUpdate({
      target: [pullRequests.repositoryId, pullRequests.githubPrNumber],
      set: {
        title: parsed.pull_request.title,
        state: prState,
        updatedAt: new Date(),
      },
    })

  // Detection ran for open/reopened/synchronize only, never for closed.
  if (parsed.action === PR_ACTIONS.CLOSED) {
    return null
  }

  return { repositoryId: repo.id, branchId: branch.id }
}

/**
 * Applies an `installation` or `installation_repositories` delivery. Returns
 * the repositories that need a `syncRepository` run; the processor enqueued
 * one maintenance job per repository here.
 */
export async function syncInstallation(
  deliveryId: string
): Promise<{ repositoryIds: string[] }> {
  'use step'

  const event = await loadEventRow(deliveryId)

  if (event.eventType === GITHUB_EVENTS.INSTALLATION_REPOSITORIES) {
    return await applyInstallationRepositories(event.payload)
  }

  const parsed = parsePayload(
    installationEventSchema,
    event.payload,
    deliveryId
  )
  const repositoryIds: string[] = []

  if (parsed.action === 'created') {
    const accountType = parsed.installation.account.type

    let organizationId: string | null = null

    if (accountType === 'Organization') {
      const [org] = await db
        .insert(organizations)
        .values({
          githubId: parsed.installation.account.id,
          name: parsed.installation.account.login,
          avatarUrl: parsed.installation.account.avatar_url,
        })
        .onConflictDoUpdate({
          target: organizations.githubId,
          set: {
            name: parsed.installation.account.login,
            avatarUrl: parsed.installation.account.avatar_url,
            updatedAt: new Date(),
          },
        })
        .returning()
      organizationId = org.id
    }

    // Link installation to user via sender.id (the person who installed)
    let userId: string | null = null
    const user = await db.query.users.findFirst({
      where: eq(users.githubId, parsed.sender.id),
    })
    if (user) {
      userId = user.id
    }

    const [installation] = await db
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
      .returning()

    // Link user to installation (many-to-many)
    if (userId) {
      await db
        .insert(userInstallations)
        .values({ userId, installationId: installation.id })
        .onConflictDoNothing()
    }

    console.log(
      `Installation created: ${parsed.installation.id} (userId: ${userId})`
    )

    if (parsed.repositories && parsed.repositories.length > 0) {
      for (const repo of parsed.repositories) {
        const [inserted] = await db
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
          .returning()

        repositoryIds.push(inserted.id)
      }
    }
  } else if (parsed.action === 'deleted') {
    const existing = await db.query.githubAppInstallations.findFirst({
      where: eq(githubAppInstallations.installationId, parsed.installation.id),
    })

    if (existing) {
      // Remove user-installation links for this installation
      await db
        .delete(userInstallations)
        .where(eq(userInstallations.installationId, existing.id))
    }

    await db
      .update(githubAppInstallations)
      .set({ status: 'deleted', updatedAt: new Date() })
      .where(eq(githubAppInstallations.installationId, parsed.installation.id))

    console.log(`Installation deleted: ${parsed.installation.id}`)
  }

  return { repositoryIds }
}

async function applyInstallationRepositories(
  payload: Record<string, unknown>
): Promise<{ repositoryIds: string[] }> {
  const action = payload.action as string
  const installationData = payload.installation as { id: number }
  const repositoryIds: string[] = []

  const installation = await db.query.githubAppInstallations.findFirst({
    where: eq(githubAppInstallations.installationId, installationData.id),
  })

  if (!installation) {
    console.log(`Installation not found: ${installationData.id}`)
    return { repositoryIds }
  }

  if (action === 'added') {
    const repos = payload.repositories_added as Array<{
      id: number
      name: string
      full_name: string
      private: boolean
    }>

    for (const repo of repos) {
      const [inserted] = await db
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
        .returning()

      repositoryIds.push(inserted.id)
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

  return { repositoryIds }
}

// ============================================================================
// Branch sync (from processors/branch-sync.ts)
// ============================================================================

/**
 * Rebuilds the file index for a branch.
 *
 * The processor caught a GitHub failure, set `changedFiles = []` and carried
 * on into the delete, wiping the branch's file index whenever GitHub had a
 * bad minute. Detection then read an empty index and resolved live overlaps.
 * The fetch failure is now thrown, so the delete below is unreachable unless
 * the fetch succeeded.
 */
export async function syncBranchFiles(input: {
  repositoryId: string
  branchName: string
  sha: string
  installationId: number
}): Promise<{ filesIndexed: number }> {
  'use step'

  const { repositoryId, branchName, sha, installationId } = input

  console.log(`Syncing branch: ${branchName} (${sha.slice(0, 7)})`)

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: { settings: true },
  })

  if (!repo) {
    throw new FatalError(`Repository not found: ${repositoryId}`)
  }

  const branch = await db.query.branches.findFirst({
    where: and(
      eq(branches.repositoryId, repositoryId),
      eq(branches.name, branchName)
    ),
  })

  if (!branch) {
    throw new FatalError(`Branch not found: ${branchName}`)
  }

  const ignoredPaths =
    repo.settings?.ignoredPaths ?? DEFAULT_SETTINGS.IGNORED_PATHS

  const github = getGitHubClient()
  const [owner, repoName] = repo.fullName.split('/')

  let changedFiles: CommitFile[]

  try {
    // Compare branch to default branch to get all changed files
    changedFiles = await github.getBranchFiles(
      installationId,
      owner,
      repoName,
      branchName,
      repo.defaultBranch
    )
  } catch (error) {
    throw classifyGitHubError(error as never)
  }

  const filteredFiles = changedFiles.filter((file) => {
    return !ignoredPaths.some((pattern) => minimatch(file.filename, pattern))
  })

  console.log(
    `Found ${filteredFiles.length} changed files (${changedFiles.length} before filtering)`
  )

  // Replace the branch's file index with what GitHub just reported.
  await db.delete(branchFiles).where(eq(branchFiles.branchId, branch.id))

  if (filteredFiles.length > 0) {
    await db.insert(branchFiles).values(
      filteredFiles.map((file) => ({
        branchId: branch.id,
        filePath: file.filename,
        changeType: mapChangeType(file.status),
      }))
    )
  }

  await db
    .update(branches)
    .set({
      sha,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(branches.id, branch.id))

  await db
    .update(repositories)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(repositories.id, repositoryId))

  console.log(`Branch sync complete: ${branchName}`)

  return { filesIndexed: filteredFiles.length }
}

// ============================================================================
// Overlap detection (from processors/overlap-detection.ts)
// ============================================================================

/**
 * Recomputes the overlaps for a branch.
 *
 * The processor enqueued a github-feedback job per open PR and a
 * push-notification job per overlap. Both are now returned as
 * `NotificationTarget[]` for the workflow to fan out. The notify decision
 * itself is unchanged: new overlap, severity increase, or reactivation.
 */
export async function detectOverlaps(input: {
  repositoryId: string
  branchId: string
}): Promise<{ overlapsFound: number; notifications: NotificationTarget[] }> {
  'use step'

  const { repositoryId, branchId } = input

  console.log(`Detecting overlaps for branch: ${branchId}`)

  const notifications: NotificationTarget[] = []

  const branch = await db.query.branches.findFirst({
    where: eq(branches.id, branchId),
    with: { files: true, repository: { with: { settings: true } } },
  })

  if (!branch) {
    throw new FatalError(`Branch not found: ${branchId}`)
  }

  if (branch.isDefault) {
    console.log('Skipping default branch')
    return { overlapsFound: 0, notifications }
  }

  if (branch.files.length === 0) {
    console.log('Branch has no tracked files')
    return { overlapsFound: 0, notifications }
  }

  const pruningDays =
    branch.repository.settings?.pruningDays ?? DEFAULT_SETTINGS.PRUNING_DAYS

  const staleDate = new Date()
  staleDate.setDate(staleDate.getDate() - pruningDays)

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

  for (const otherBranch of otherBranches) {
    const overlappingFiles: Array<{
      filePath: string
      sourceChangeType: string
      targetChangeType: string
    }> = []

    for (const otherFile of otherBranch.files) {
      if (branchFilePaths.has(otherFile.filePath)) {
        const sourceFile = branch.files.find(
          (f) => f.filePath === otherFile.filePath
        )
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
      const oldSeverity = existingOverlap.severity
      severityIncreased = compareSeverity(severity, oldSeverity as Severity) > 0
      wasReactivated =
        existingOverlap.status === 'resolved' ||
        existingOverlap.status === 'ignored'

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

      await db.delete(overlapFiles).where(eq(overlapFiles.overlapId, overlapId))
    } else {
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

    await db.insert(overlapFiles).values(
      detected.files.map((f) => ({
        overlapId,
        filePath: f.filePath,
        sourceChangeType: f.sourceChangeType,
        targetChangeType: f.targetChangeType,
      }))
    )

    // Notify on: new overlaps, severity increases, or reactivated overlaps
    // (previously resolved/ignored but the file was edited again)
    const shouldNotify =
      (isNew && branch.repository.settings?.notifyOnNewOverlap !== false) ||
      (severityIncreased &&
        branch.repository.settings?.notifyOnSeverityIncrease !== false) ||
      wasReactivated

    if (shouldNotify) {
      // Any open PR for this branch gets a check run.
      const openPRs = await db.query.pullRequests.findMany({
        where: and(
          eq(pullRequests.branchId, branchId),
          eq(pullRequests.state, 'open')
        ),
      })

      // The push notification goes to the developer on the OTHER branch:
      // if A pushed and overlaps with B, notify B's developer.
      notifications.push({
        repositoryId,
        overlapId,
        targetBranchId: detected.targetBranchId,
        pullRequestIds: openPRs.map((pr) => pr.id),
      })
    }
  }

  // Resolve overlaps that no longer have overlapping files
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
      overlap.sourceBranchId === branchId
        ? overlap.targetBranchId
        : overlap.sourceBranchId

    if (!activeTargetIds.has(otherBranchId)) {
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

  return { overlapsFound: detectedOverlaps.length, notifications }
}

// ============================================================================
// GitHub feedback (from processors/github-feedback.ts)
// ============================================================================

/**
 * Publishes the overlap check run on a pull request.
 *
 * The processor logged and swallowed `createCheckRun` failures, then recorded
 * a `prAlerts` row with a null check run id as if the alert had been
 * delivered. The failure is now classified and thrown, so a transient GitHub
 * error is retried instead of being recorded as a delivered alert.
 */
export async function postCheckRun(input: {
  repositoryId: string
  pullRequestId: string
  overlapId: string
}): Promise<{ checkRunId: number | null }> {
  'use step'

  const { repositoryId, pullRequestId, overlapId } = input

  console.log(
    `Sending GitHub feedback for PR: ${pullRequestId}, overlap: ${overlapId}`
  )

  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, pullRequestId),
    with: {
      branch: true,
      repository: {
        with: {
          installation: true,
        },
      },
    },
  })

  if (!pr) {
    throw new FatalError(`Pull request not found: ${pullRequestId}`)
  }

  const overlap = await db.query.overlaps.findFirst({
    where: eq(overlaps.id, overlapId),
    with: {
      files: true,
      sourceBranch: true,
      targetBranch: true,
    },
  })

  if (!overlap) {
    throw new FatalError(`Overlap not found: ${overlapId}`)
  }

  // Report every active overlap on this branch, not just the trigger.
  const allOverlaps = await db.query.overlaps.findMany({
    where: and(
      eq(overlaps.repositoryId, repositoryId),
      eq(overlaps.status, 'active')
    ),
    with: {
      files: true,
      sourceBranch: true,
      targetBranch: true,
    },
  })

  const branchOverlaps = allOverlaps.filter(
    (o) => o.sourceBranchId === pr.branch.id || o.targetBranchId === pr.branch.id
  )

  if (branchOverlaps.length === 0) {
    console.log('No active overlaps for this branch')
    return { checkRunId: null }
  }

  const existingAlert = await db.query.prAlerts.findFirst({
    where: and(
      eq(prAlerts.pullRequestId, pullRequestId),
      eq(prAlerts.overlapId, overlapId)
    ),
  })

  const github = getGitHubClient()
  const [owner, repoName] = pr.repository.fullName.split('/')
  const installationId = pr.repository.installation.installationId

  let checkRunId: number | null = existingAlert?.checkRunId ?? null

  const overlapData = branchOverlaps.map((o) => {
    const otherBranch =
      o.sourceBranchId === pr.branch.id ? o.targetBranch : o.sourceBranch

    return {
      branchName: otherBranch.name,
      files: o.files.map((f) => f.filePath),
      fileCount: o.fileCount,
      severity: o.severity as Severity,
    }
  })

  // Create check run (no PR comments - GitHub already shows conflicts)
  const { conclusion, title, summary } = formatCheckRunSummary(overlapData)

  try {
    checkRunId = await github.createCheckRun(
      installationId,
      owner,
      repoName,
      pr.branch.sha,
      'Overlap Detection',
      conclusion,
      title,
      summary
    )
    console.log(`Check run created: ${checkRunId}`)
  } catch (error) {
    throw classifyGitHubError(error as never)
  }

  if (existingAlert) {
    await db
      .update(prAlerts)
      .set({ checkRunId })
      .where(eq(prAlerts.id, existingAlert.id))
  } else {
    await db.insert(prAlerts).values({
      pullRequestId,
      overlapId,
      alertType: 'check_run',
      checkRunId,
    })
  }

  return { checkRunId }
}

// ============================================================================
// Push notification (from processors/push-notification.ts)
// ============================================================================

/**
 * Sends the web push notification for an overlap to the last pusher on the
 * target branch.
 */
export async function sendPush(input: {
  repositoryId: string
  overlapId: string
  targetBranchId: string
}): Promise<{ sent: number }> {
  'use step'

  const { repositoryId, overlapId, targetBranchId } = input

  const appUrl = process.env.APP_URL || 'http://localhost:3000'
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
  const vapidSubject = process.env.VAPID_SUBJECT

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.log('VAPID keys not configured, skipping push notification')
    return { sent: 0 }
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)

  const overlap = await db.query.overlaps.findFirst({
    where: eq(overlaps.id, overlapId),
    with: {
      sourceBranch: true,
      targetBranch: true,
      files: true,
    },
  })

  if (!overlap) {
    console.log(`Overlap not found: ${overlapId}`)
    return { sent: 0 }
  }

  const targetBranch = await db.query.branches.findFirst({
    where: eq(branches.id, targetBranchId),
  })

  if (!targetBranch?.lastPusherGithubId) {
    console.log(`No pusher info for branch: ${targetBranchId}`)
    return { sent: 0 }
  }

  const user = await db.query.users.findFirst({
    where: eq(users.githubId, targetBranch.lastPusherGithubId),
  })

  if (!user) {
    console.log(
      `User not found for githubId: ${targetBranch.lastPusherGithubId}`
    )
    return { sent: 0 }
  }

  const subscriptions = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.userId, user.id),
  })

  if (subscriptions.length === 0) {
    console.log(`No push subscriptions for user: ${user.id}`)
    return { sent: 0 }
  }

  // Orient so the recipient's branch appears first (same as UI auto-orient)
  const isRecipientSource = overlap.sourceBranchId === targetBranchId
  const yourBranch = isRecipientSource
    ? overlap.sourceBranch.name
    : overlap.targetBranch.name
  const otherBranch = isRecipientSource
    ? overlap.targetBranch.name
    : overlap.sourceBranch.name
  const fileCount = overlap.files.length

  const payload = JSON.stringify({
    title: `Overlap Detected · ${fileCount} file${fileCount !== 1 ? 's' : ''}`,
    body: `${yourBranch} ↔ ${otherBranch}`,
    url: `${appUrl}/repositories/${repositoryId}`,
    tag: `overlap-${overlapId}`,
  })

  let sent = 0

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        payload
      )
      sent++
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      // Remove expired/invalid subscriptions
      if (statusCode === 404 || statusCode === 410) {
        await db
          .delete(pushSubscriptions)
          .where(eq(pushSubscriptions.id, sub.id))
        console.log(`Removed expired subscription: ${sub.id}`)
      } else {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`Failed to send push to ${sub.endpoint}:`, message)
      }
    }
  }

  console.log(
    `Sent ${sent}/${subscriptions.length} push notifications for overlap ${overlapId}`
  )
  return { sent }
}

// ============================================================================
// Maintenance (from processors/maintenance.ts)
// ============================================================================

/**
 * Reconciles the local branch list for a repository against GitHub.
 */
export async function syncRepository(repositoryId: string): Promise<{
  added: number
  updated: number
  markedForDeletion: number
}> {
  'use step'

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: { installation: true },
  })

  if (!repo) {
    throw new FatalError(`Repository not found: ${repositoryId}`)
  }

  const github = getGitHubClient()
  const [owner, repoName] = repo.fullName.split('/')

  let remoteBranches
  try {
    remoteBranches = await github.getBranches(
      repo.installation.installationId,
      owner,
      repoName
    )
  } catch (error) {
    throw classifyGitHubError(error as never)
  }

  const localBranches = await db.query.branches.findMany({
    where: eq(branches.repositoryId, repositoryId),
  })

  const localBranchMap = new Map(localBranches.map((b) => [b.name, b]))
  const remoteBranchNames = new Set(remoteBranches.map((b) => b.name))

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

  await db
    .update(repositories)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(repositories.id, repositoryId))

  console.log(
    `Synced repository: added ${addedCount}, updated ${updatedCount}, marked ${deletedCount} for deletion`
  )

  return {
    added: addedCount,
    updated: updatedCount,
    markedForDeletion: deletedCount,
  }
}

/**
 * Deletes branches nobody has pushed to inside the repository's pruning
 * window, resolving any overlap that involved them.
 */
export async function pruneStaleBranches(
  repositoryId?: string
): Promise<{ prunedBranches: number }> {
  'use step'

  let prunedCount = 0

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

    await db
      .delete(branchFiles)
      .where(inArray(branchFiles.branchId, staleBranchIds))

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

    await db.delete(branches).where(inArray(branches.id, staleBranchIds))

    prunedCount += staleBranches.length
    console.log(
      `Pruned ${staleBranches.length} stale branches from ${repo.fullName}`
    )
  }

  return { prunedBranches: prunedCount }
}

/**
 * Drops webhook event rows older than seven days.
 */
export async function cleanupOldEvents(): Promise<{ cleaned: boolean }> {
  'use step'

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - 7)

  await db.delete(webhookEvents).where(lt(webhookEvents.createdAt, cutoffDate))

  console.log('Cleaned up old webhook events')
  return { cleaned: true }
}
