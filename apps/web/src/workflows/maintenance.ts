/**
 * Maintenance workflows.
 *
 * These replace the repeatable BullMQ maintenance jobs. Each one is a thin
 * durable wrapper around a single step so it can be triggered from a Vercel
 * cron route and observed as a run.
 */

import {
  cleanupOldEvents,
  getActiveRepositoryIds,
  pruneRepositoryBranches,
} from './steps'

/**
 * Deletes branches nobody has pushed to inside each repository's pruning
 * window.
 *
 * Each repository is its own durable step (`pruneRepositoryBranches`), fanned
 * out over from the id list `getActiveRepositoryIds` returns - the same
 * pattern `processWebhook` uses for `syncRepository`. No single step
 * processes more than one repository, so this workflow's total runtime
 * scales with the number of installations without any one function
 * invocation needing to cover all of them.
 */
export async function pruneBranchesWorkflow(): Promise<{
  prunedBranches: number
}> {
  'use workflow'

  const { repositoryIds } = await getActiveRepositoryIds()

  let prunedBranches = 0
  for (const repositoryId of repositoryIds) {
    const result = await pruneRepositoryBranches(repositoryId)
    prunedBranches += result.prunedBranches
  }

  return { prunedBranches }
}

/**
 * Drops webhook event rows older than seven days.
 */
export async function cleanupEventsWorkflow(): Promise<{ cleaned: boolean }> {
  'use workflow'

  return await cleanupOldEvents()
}
