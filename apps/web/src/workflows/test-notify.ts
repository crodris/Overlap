/**
 * Dev-only notification workflow.
 *
 * The Fastify app let a developer replay the push notification for an existing
 * overlap by enqueueing a BullMQ `pushNotification` job directly from the route
 * handler. Routes cannot invoke a step's durable semantics on their own, so the
 * dev-only endpoint starts this workflow instead.
 */

import { sendPush } from './steps'

export async function testNotifyWorkflow(
  repositoryId: string,
  overlapId: string,
  targetBranchId: string
): Promise<{ sent: number }> {
  'use workflow'

  return await sendPush({ repositoryId, overlapId, targetBranchId })
}
