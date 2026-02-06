import type { FastifyInstance } from 'fastify'
import { db, pushSubscriptions } from '@overlap/db'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../plugins/auth.js'

// Legitimate browser push service domains
const ALLOWED_PUSH_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'notify.windows.com',
  'web.push.apple.com',
]

function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false

  const hostname = url.hostname.toLowerCase()
  return ALLOWED_PUSH_HOSTS.some(
    (domain) => hostname === domain || hostname.endsWith('.' + domain)
  )
}

export async function pushRoute(fastify: FastifyInstance) {
  // All push routes require authentication
  fastify.addHook('preHandler', requireAuth)

  // Subscribe to push notifications
  fastify.post<{
    Body: { endpoint: string; keys: { p256dh: string; auth: string } }
  }>('/subscribe', async (request, reply) => {
    const { endpoint, keys } = request.body

    if (!isAllowedPushEndpoint(endpoint)) {
      return reply.status(400).send({ error: 'Invalid push endpoint' })
    }

    await db
      .insert(pushSubscriptions)
      .values({
        userId: request.user!.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      })
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: {
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
      })

    return { success: true }
  })

  // Unsubscribe from push notifications
  fastify.delete<{ Body: { endpoint: string } }>('/unsubscribe', async (request) => {
    const { endpoint } = request.body

    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, request.user!.id),
          eq(pushSubscriptions.endpoint, endpoint)
        )
      )

    return { success: true }
  })
}
