import { createFileRoute } from '@tanstack/react-router'
import { db, pushSubscriptions } from '@overlap/db'
import { eq, and } from 'drizzle-orm'
import { requireUser } from '../../lib/auth'

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

export const Route = createFileRoute('/api/push')({
  server: {
    handlers: {
      // Subscribe to push notifications
      POST: async ({ request }) => {
        try {
          const user = await requireUser(request)
          const { endpoint, keys } = (await request.json()) as {
            endpoint: string
            keys: { p256dh: string; auth: string }
          }

          if (!isAllowedPushEndpoint(endpoint)) {
            return Response.json({ error: 'Invalid push endpoint' }, { status: 400 })
          }

          const MAX_SUBSCRIPTIONS_PER_USER = 20

          const existing = await db.query.pushSubscriptions.findMany({
            where: eq(pushSubscriptions.userId, user.id),
          })

          const isKnownEndpoint = existing.some((s) => s.endpoint === endpoint)

          if (!isKnownEndpoint && existing.length >= MAX_SUBSCRIPTIONS_PER_USER) {
            return Response.json({ error: 'Subscription limit reached' }, { status: 429 })
          }

          await db
            .insert(pushSubscriptions)
            .values({
              userId: user.id,
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

          return Response.json({ success: true })
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
      // Unsubscribe from push notifications
      DELETE: async ({ request }) => {
        try {
          const user = await requireUser(request)
          const { endpoint } = (await request.json()) as { endpoint: string }

          await db
            .delete(pushSubscriptions)
            .where(
              and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint))
            )

          return Response.json({ success: true })
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
