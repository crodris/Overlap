import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { authPlugin } from './plugins/auth.js'
import { webhooksRoute } from './routes/webhooks.js'
import { healthRoute } from './routes/health.js'
import { repositoriesRoute } from './routes/repositories.js'
import { authRoute } from './routes/auth.js'
import { pushRoute } from './routes/push.js'
import { setupQueues } from './queues/index.js'
import { setupScheduler } from './scheduler.js'

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  },
})

async function start() {
  try {
    // Register plugins
    await fastify.register(cors, {
      origin: process.env.APP_URL || 'http://localhost:3000',
      credentials: true,
    })

    await fastify.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
    })

    // Register auth plugin (cookie parsing + session)
    await fastify.register(authPlugin)

    // Setup BullMQ queues
    const queues = setupQueues()
    fastify.decorate('queues', queues)

    // Register routes
    await fastify.register(healthRoute, { prefix: '/health' })
    await fastify.register(webhooksRoute, { prefix: '/webhooks' })
    await fastify.register(authRoute, { prefix: '/auth' })
    await fastify.register(repositoriesRoute, { prefix: '/api/repositories' })
    await fastify.register(pushRoute, { prefix: '/api/push' })

    // Setup scheduled jobs
    await setupScheduler()

    // Start server
    const port = parseInt(process.env.PORT || '3001', 10)
    const host = process.env.HOST || '0.0.0.0'

    await fastify.listen({ port, host })
    fastify.log.info(`Server listening on ${host}:${port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

// Graceful shutdown
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
for (const signal of signals) {
  process.on(signal, async () => {
    fastify.log.info(`Received ${signal}, shutting down...`)
    await fastify.close()
    process.exit(0)
  })
}

start()
