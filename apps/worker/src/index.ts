import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { QUEUE_NAMES, RATE_LIMITS } from '@overlap/shared'
import { webhookEventsProcessor } from './processors/webhook-events.js'
import { branchSyncProcessor } from './processors/branch-sync.js'
import { overlapDetectionProcessor } from './processors/overlap-detection.js'
import { githubFeedbackProcessor } from './processors/github-feedback.js'
import { maintenanceProcessor } from './processors/maintenance.js'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
})

console.log('Starting Overlap workers...')

// Create workers with rate limiting
const workers: Worker[] = []

// Webhook Events Worker
workers.push(
  new Worker(QUEUE_NAMES.WEBHOOK_EVENTS, webhookEventsProcessor, {
    connection,
    concurrency: 10,
    limiter: RATE_LIMITS[QUEUE_NAMES.WEBHOOK_EVENTS],
  })
)

// Branch Sync Worker
workers.push(
  new Worker(QUEUE_NAMES.BRANCH_SYNC, branchSyncProcessor, {
    connection,
    concurrency: 5,
    limiter: RATE_LIMITS[QUEUE_NAMES.BRANCH_SYNC],
  })
)

// Overlap Detection Worker
workers.push(
  new Worker(QUEUE_NAMES.OVERLAP_DETECTION, overlapDetectionProcessor, {
    connection,
    concurrency: 10,
    limiter: RATE_LIMITS[QUEUE_NAMES.OVERLAP_DETECTION],
  })
)

// GitHub Feedback Worker
workers.push(
  new Worker(QUEUE_NAMES.GITHUB_FEEDBACK, githubFeedbackProcessor, {
    connection,
    concurrency: 2,
    limiter: RATE_LIMITS[QUEUE_NAMES.GITHUB_FEEDBACK],
  })
)

// Maintenance Worker
workers.push(
  new Worker(QUEUE_NAMES.MAINTENANCE, maintenanceProcessor, {
    connection,
    concurrency: 1,
    limiter: RATE_LIMITS[QUEUE_NAMES.MAINTENANCE],
  })
)

// Setup event handlers for all workers
for (const worker of workers) {
  worker.on('completed', (job) => {
    console.log(`[${worker.name}] Job ${job.id} completed`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[${worker.name}] Job ${job?.id} failed:`, err.message)
  })

  worker.on('error', (err) => {
    console.error(`[${worker.name}] Worker error:`, err.message)
  })
}

console.log(`Started ${workers.length} workers`)

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down workers...')

  await Promise.all(workers.map((w) => w.close()))
  await connection.quit()

  console.log('Workers shut down')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
