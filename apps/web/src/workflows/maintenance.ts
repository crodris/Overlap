/**
 * Maintenance workflows.
 *
 * These replace the repeatable BullMQ maintenance jobs. Each one is a thin
 * durable wrapper around a single step so it can be triggered from a Vercel
 * cron route and observed as a run.
 */

import { cleanupOldEvents, pruneStaleBranches, syncRepository } from './steps'

/**
 * Deletes branches nobody has pushed to inside each repository's pruning
 * window.
 */
export async function pruneBranchesWorkflow(): Promise<{
  prunedBranches: number
}> {
  'use workflow'

  return await pruneStaleBranches()
}

/**
 * Drops webhook event rows older than seven days.
 */
export async function cleanupEventsWorkflow(): Promise<{ cleaned: boolean }> {
  'use workflow'

  return await cleanupOldEvents()
}

/**
 * Reconciles one repository's branch list against GitHub.
 */
export async function syncRepositoryWorkflow(
  repositoryId: string
): Promise<void> {
  'use workflow'

  await syncRepository(repositoryId)
}
