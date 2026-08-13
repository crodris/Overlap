/**
 * The webhook workflow.
 *
 * This file is the reason for the migration. In the BullMQ system a push
 * delivery enqueued a branch-sync job and, separately, an overlap-detection
 * job with `delay: 5000` and the comment "Small delay to ensure sync completes
 * first". That was a hope, not an ordering guarantee: whenever the sync took
 * longer than five seconds, detection read a stale file index and computed the
 * wrong overlaps.
 *
 * `await syncBranchFiles(...)` followed by `await detectOverlaps(...)` below is
 * a real happens-before edge recorded in the workflow's event log. There is no
 * delay, no sleep, and no timing assumption anywhere in this file, and there
 * must never be one.
 *
 * Only orchestration lives here: this function runs in the workflow sandbox
 * with no Node.js access. Every piece of I/O is inside a step in `./steps`.
 * The orchestration is deliberately written inline rather than split into
 * helper functions, so the compiler can see every step call and emit an
 * accurate workflow graph.
 */

import {
  detectOverlaps,
  loadEvent,
  markEventProcessed,
  postCheckRun,
  sendPush,
  syncBranchFiles,
  syncInstallation,
  syncRepository,
  upsertBranch,
  upsertPullRequest,
} from './steps'
import type { NotificationTarget } from './steps'

/**
 * Processes one stored webhook delivery.
 *
 * The BullMQ processor recorded the outcome of a delivery in its own
 * try/catch, so the bookkeeping was structural. Here it is the workflow
 * author's job: `markEventProcessed` has to run on both paths, or every
 * `webhook_events` row stays unprocessed forever and failures leave no trace.
 * The failure path records the error and rethrows so the run itself still
 * fails.
 */
export async function processWebhook(
  deliveryId: string
): Promise<{ handled: boolean }> {
  'use workflow'

  try {
    const event = await loadEvent(deliveryId)

    let handled = false
    let notifications: NotificationTarget[] = []

    if (event.type === 'push') {
      const branch = await upsertBranch(deliveryId)

      // Null means there is nothing to sync: a non-branch ref, a branch
      // deletion, or an unknown repository.
      if (branch) {
        // The happens-before edge. Detection reads the file index this call
        // writes, so it is awaited, never raced against a timer.
        await syncBranchFiles({
          repositoryId: branch.repositoryId,
          branchName: branch.branchName,
          sha: branch.sha,
          installationId: branch.installationId,
        })

        // The default branch is the comparison baseline; it never overlaps.
        if (!branch.isDefault) {
          const result = await detectOverlaps({
            repositoryId: branch.repositoryId,
            branchId: branch.branchId,
          })
          notifications = result.notifications
        }

        handled = true
      }
    } else if (event.type === 'pull_request') {
      const pullRequest = await upsertPullRequest(deliveryId)

      // Null means an ignored action, an unknown repository or branch, or a
      // closed pull request.
      if (pullRequest) {
        // No branch sync here: a pull_request delivery does not change the
        // head commit, so the index the preceding push wrote is current.
        const result = await detectOverlaps({
          repositoryId: pullRequest.repositoryId,
          branchId: pullRequest.branchId,
        })
        notifications = result.notifications

        handled = true
      }
    } else if (event.type === 'installation') {
      const { repositoryIds } = await syncInstallation(deliveryId)

      for (const repositoryId of repositoryIds) {
        await syncRepository(repositoryId)
      }

      handled = true
    }

    // `detectOverlaps` builds `pullRequestIds` from one query - the open pull
    // requests of the branch that was pushed - so every notification carries
    // an identical array. Walking notifications and then pull request ids
    // would issue N*M `postCheckRun` calls for N overlaps and M open pull
    // requests, and each call does the same work: `postCheckRun` already
    // reports *all* active overlaps for the branch in a single check run.
    // Posting once per pull request produces the same GitHub state for a
    // fraction of the API calls. A pull request keeps the overlap id of the
    // first notification that named it, which stays correct even if the id
    // lists ever stop being identical.
    const postedPullRequestIds: string[] = []

    for (const notification of notifications) {
      for (const pullRequestId of notification.pullRequestIds) {
        if (postedPullRequestIds.includes(pullRequestId)) continue
        postedPullRequestIds.push(pullRequestId)

        await postCheckRun({
          repositoryId: notification.repositoryId,
          pullRequestId,
          overlapId: notification.overlapId,
        })
      }
    }

    // The push notification is per overlap, not per pull request: it goes to
    // the developer on the other branch.
    for (const notification of notifications) {
      await sendPush({
        repositoryId: notification.repositoryId,
        overlapId: notification.overlapId,
        targetBranchId: notification.targetBranchId,
      })
    }

    await markEventProcessed(deliveryId)

    return { handled }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markEventProcessed(deliveryId, message)
    throw error
  }
}
