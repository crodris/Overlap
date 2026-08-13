import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { db, overlaps } from '@overlap/db'
import { eq, and } from 'drizzle-orm'
import { repositoryIdParamSchema } from '@overlap/shared'
import { requireUser } from '../../lib/auth'
import { requireRepoAccess } from '../../lib/repo-access'

export const Route = createFileRoute('/api/repositories/$id/overlaps/$overlapId/test-notify')({
  server: {
    handlers: {
      // DEV ONLY: Test push notification for an existing overlap
      POST: async ({ request, params }) => {
        try {
          const user = await requireUser(request)

          if (process.env.NODE_ENV === 'production') {
            return json({ error: 'Not found' }, { status: 404 })
          }

          const { id } = repositoryIdParamSchema.parse(params)
          const overlapId = params.overlapId

          await requireRepoAccess(user, id)

          const overlap = await db.query.overlaps.findFirst({
            where: and(eq(overlaps.id, overlapId), eq(overlaps.repositoryId, id)),
            with: { sourceBranch: true, targetBranch: true },
          })

          if (!overlap) {
            return json({ error: 'Overlap not found' }, { status: 404 })
          }

          // The original Fastify handler queued this via BullMQ
          // (fastify.queues.pushNotification.add(...)). That queue does not
          // exist in this app: push dispatch becomes the "sendPush" workflow
          // step ported in a later task of this migration. Until that step
          // and its trigger exist, this dev-only endpoint cannot actually
          // send a notification.
          return json(
            { success: false, message: 'Push notification dispatch not yet wired up' },
            { status: 501 }
          )
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
