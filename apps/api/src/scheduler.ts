import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { QUEUE_NAMES } from '@overlap/shared'
import type { MaintenanceJob } from '@overlap/shared'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

export async function setupScheduler() {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })

  const maintenanceQueue = new Queue<MaintenanceJob>(QUEUE_NAMES.MAINTENANCE, {
    connection,
  })

  // Schedule branch pruning every 6 hours
  await maintenanceQueue.upsertJobScheduler(
    'prune-branches',
    {
      every: 6 * 60 * 60 * 1000, // 6 hours
    },
    {
      name: 'prune_branches',
      data: { type: 'prune_branches' },
    }
  )

  // Schedule event cleanup daily
  await maintenanceQueue.upsertJobScheduler(
    'cleanup-events',
    {
      every: 24 * 60 * 60 * 1000, // 24 hours
    },
    {
      name: 'cleanup_events',
      data: { type: 'cleanup_events' },
    }
  )

  console.log('Scheduled maintenance jobs configured')

  return { maintenanceQueue }
}
