import type { FastifyInstance } from 'fastify'
import { db } from '@overlap/db'
import { sql } from 'drizzle-orm'

export async function healthRoute(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  fastify.get('/ready', async (request, reply) => {
    const checks: Record<string, boolean> = {
      database: false,
      redis: false,
    }

    // Check database
    try {
      await db.execute(sql`SELECT 1`)
      checks.database = true
    } catch (err) {
      fastify.log.error({ err }, 'Database health check failed')
    }

    // Check Redis via BullMQ queue
    try {
      const client = await fastify.queues.webhookEvents.client
      await client.ping()
      checks.redis = true
    } catch (err) {
      fastify.log.error({ err }, 'Redis health check failed')
    }

    const allHealthy = Object.values(checks).every((v) => v)

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'ready' : 'not ready',
      checks,
      timestamp: new Date().toISOString(),
    })
  })
}
