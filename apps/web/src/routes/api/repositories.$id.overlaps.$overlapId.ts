import { createFileRoute } from '@tanstack/react-router'
import { db, overlaps } from '@overlap/db'
import { eq, and } from 'drizzle-orm'
import { repositoryIdParamSchema, overlapUpdateSchema, idSchema } from '@overlap/shared'
import { requireUser } from '../../lib/auth'
import { requireRepoAccess } from '../../lib/repo-access'

export const Route = createFileRoute('/api/repositories/$id/overlaps/$overlapId')({
  server: {
    handlers: {
      // Update overlap status (resolve/ignore)
      PATCH: async ({ request, params }) => {
        try {
          const user = await requireUser(request)
          const { id } = repositoryIdParamSchema.parse(params)
          const { status } = overlapUpdateSchema.parse(await request.json())

          // `overlapId` never went through a schema, so a non-UUID value
          // (e.g. a stray path segment) reached the query below raw and
          // Postgres rejected it with 22P02 ("invalid input syntax for
          // type uuid"), which escaped the `catch (res)` block below as an
          // unhandled 500 instead of the 404 a bad id should produce.
          // Validating up front folds that case into the same "not found"
          // response an unrecognized-but-well-formed id already gets.
          const parsedOverlapId = idSchema.safeParse(params.overlapId)
          if (!parsedOverlapId.success) {
            return Response.json({ error: 'Overlap not found' }, { status: 404 })
          }
          const overlapId = parsedOverlapId.data

          await requireRepoAccess(user, id)

          const overlap = await db.query.overlaps.findFirst({
            where: and(eq(overlaps.id, overlapId), eq(overlaps.repositoryId, id)),
          })

          if (!overlap) {
            return Response.json({ error: 'Overlap not found' }, { status: 404 })
          }

          const [updated] = await db
            .update(overlaps)
            .set({
              status,
              resolvedAt: status === 'resolved' ? new Date() : null,
              updatedAt: new Date(),
            })
            .where(eq(overlaps.id, overlapId))
            .returning()

          return Response.json(updated)
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
