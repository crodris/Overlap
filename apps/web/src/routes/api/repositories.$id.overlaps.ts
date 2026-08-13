import { createFileRoute } from '@tanstack/react-router'
import { db, overlaps } from '@overlap/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { repositoryIdParamSchema, overlapQuerySchema } from '@overlap/shared'
import { requireUser } from '../../lib/auth'
import { requireRepoAccess } from '../../lib/repo-access'

export const Route = createFileRoute('/api/repositories/$id/overlaps')({
  server: {
    handlers: {
      // List overlaps for a repository
      GET: async ({ request, params }) => {
        try {
          const user = await requireUser(request)
          const { id } = repositoryIdParamSchema.parse(params)
          const url = new URL(request.url)
          const { status, severity, branchId, page, limit } = overlapQuerySchema.parse(
            Object.fromEntries(url.searchParams)
          )

          await requireRepoAccess(user, id)

          const conditions = [eq(overlaps.repositoryId, id)]

          if (status) {
            conditions.push(eq(overlaps.status, status))
          }

          if (severity) {
            conditions.push(eq(overlaps.severity, severity))
          }

          if (branchId) {
            conditions.push(
              sql`(${overlaps.sourceBranchId} = ${branchId} OR ${overlaps.targetBranchId} = ${branchId})`
            )
          }

          const overlapList = await db.query.overlaps.findMany({
            where: and(...conditions),
            with: {
              sourceBranch: true,
              targetBranch: true,
              files: true,
            },
            orderBy: desc(overlaps.detectedAt),
            limit,
            offset: (page - 1) * limit,
          })

          return Response.json(overlapList)
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
