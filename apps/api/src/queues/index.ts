import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { QUEUE_NAMES, type QueueName } from '@overlap/shared'
import type {
  WebhookEventJob,
  BranchSyncJob,
  OverlapDetectionJob,
  GitHubFeedbackJob,
  MaintenanceJob,
} from '@overlap/shared'

export type Queues = {
  webhookEvents: Queue<WebhookEventJob>
  branchSync: Queue<BranchSyncJob>
  overlapDetection: Queue<OverlapDetectionJob>
  githubFeedback: Queue<GitHubFeedbackJob>
  maintenance: Queue<MaintenanceJob>
}

let connection: Redis | null = null

function getConnection(): Redis {
  if (!connection) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
    connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    })
  }
  return connection
}

export function setupQueues(): Queues {
  const conn = getConnection()

  const defaultJobOptions = {
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400, count: 5000 },
  }

  return {
    webhookEvents: new Queue<WebhookEventJob>(QUEUE_NAMES.WEBHOOK_EVENTS, {
      connection: conn,
      defaultJobOptions,
    }),
    branchSync: new Queue<BranchSyncJob>(QUEUE_NAMES.BRANCH_SYNC, {
      connection: conn,
      defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    }),
    overlapDetection: new Queue<OverlapDetectionJob>(QUEUE_NAMES.OVERLAP_DETECTION, {
      connection: conn,
      defaultJobOptions,
    }),
    githubFeedback: new Queue<GitHubFeedbackJob>(QUEUE_NAMES.GITHUB_FEEDBACK, {
      connection: conn,
      defaultJobOptions: {
        ...defaultJobOptions,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10000,
        },
      },
    }),
    maintenance: new Queue<MaintenanceJob>(QUEUE_NAMES.MAINTENANCE, {
      connection: conn,
      defaultJobOptions,
    }),
  }
}

export async function addWebhookEventJob(
  queues: Queues,
  job: WebhookEventJob
): Promise<void> {
  await queues.webhookEvents.add('process', job, {
    jobId: job.deliveryId,
  })
}

export async function addBranchSyncJob(
  queues: Queues,
  job: BranchSyncJob
): Promise<void> {
  const jobId = `${job.repositoryId}:${job.branchName}:${job.sha}`
  await queues.branchSync.add('sync', job, { jobId })
}

export async function addOverlapDetectionJob(
  queues: Queues,
  job: OverlapDetectionJob
): Promise<void> {
  const jobId = `${job.repositoryId}:${job.branchId}:${Date.now()}`
  await queues.overlapDetection.add('detect', job, { jobId })
}

export async function addGitHubFeedbackJob(
  queues: Queues,
  job: GitHubFeedbackJob
): Promise<void> {
  const jobId = `${job.pullRequestId}:${job.overlapId}`
  await queues.githubFeedback.add('feedback', job, { jobId })
}

export async function addMaintenanceJob(
  queues: Queues,
  job: MaintenanceJob
): Promise<void> {
  const jobId = job.repositoryId
    ? `${job.type}:${job.repositoryId}`
    : `${job.type}:global`
  await queues.maintenance.add(job.type, job, { jobId })
}

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    queues: Queues
  }
}
