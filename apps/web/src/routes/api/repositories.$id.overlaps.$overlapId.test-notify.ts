import { createFileRoute } from '@tanstack/react-router'
import { db, overlaps } from '@overlap/db'
import { eq, and } from 'drizzle-orm'
import { repositoryIdParamSchema, idSchema } from '@overlap/shared'
import { start } from 'workflow/api'
import { requireUser } from '../../lib/auth'
import { requireRepoAccess } from '../../lib/repo-access'
import { testNotifyWorkflow } from '../../workflows/test-notify'

export const Route = createFileRoute('/api/repositories/$id/overlaps/$overlapId/test-notify')({
  server: {
    handlers: {
      // DEV ONLY: Test push notification for an existing overlap
      POST: async ({ request, params }) => {
        try {
          if (process.env.NODE_ENV === 'production') {
            return Response.json({ error: 'Not found' }, { status: 404 })
          }

          const user = await requireUser(request)

          const { id } = repositoryIdParamSchema.parse(params)

          // See repositories.$id.overlaps.$overlapId.ts: `overlapId` never
          // went through a schema, so a non-UUID value reached the query
          // below raw and Postgres rejected it with 22P02, which escaped
          // this route's `catch (res)` block as an unhandled 500 instead of
          // a 404.
          const parsedOverlapId = idSchema.safeParse(params.overlapId)
          if (!parsedOverlapId.success) {
            return Response.json({ error: 'Overlap not found' }, { status: 404 })
          }
          const overlapId = parsedOverlapId.data

          await requireRepoAccess(user, id)

          const overlap = await db.query.overlaps.findFirst({
            where: and(eq(overlaps.id, overlapId), eq(overlaps.repositoryId, id)),
            with: { sourceBranch: true, targetBranch: true },
          })

          if (!overlap) {
            return Response.json({ error: 'Overlap not found' }, { status: 404 })
          }

          // The original Fastify handler queued this via BullMQ
          // (fastify.queues.pushNotification.add(...)). The replacement is a
          // durable run of the "sendPush" step.
          const run = await start(testNotifyWorkflow, [
            id,
            overlapId,
            overlap.targetBranchId,
          ])

          return Response.json({
            success: true,
            message: 'Test notification queued',
            runId: run.runId,
          })
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
