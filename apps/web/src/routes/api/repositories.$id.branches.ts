import { createFileRoute } from '@tanstack/react-router'
import { db, branches } from '@overlap/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { repositoryIdParamSchema, branchQuerySchema } from '@overlap/shared'
import { requireUser } from '../../lib/auth'
import { requireRepoAccess } from '../../lib/repo-access'

export const Route = createFileRoute('/api/repositories/$id/branches')({
  server: {
    handlers: {
      // List branches for a repository
      GET: async ({ request, params }) => {
        try {
          const user = await requireUser(request)
          const { id } = repositoryIdParamSchema.parse(params)
          const url = new URL(request.url)
          const { includeDefault, includeStale, page, limit } = branchQuerySchema.parse(
            Object.fromEntries(url.searchParams)
          )

          await requireRepoAccess(user, id)

          const conditions = [eq(branches.repositoryId, id)]

          if (!includeDefault) {
            conditions.push(eq(branches.isDefault, false))
          }

          if (!includeStale) {
            const staleDate = new Date()
            staleDate.setDate(staleDate.getDate() - 14)
            conditions.push(sql`${branches.lastSeenAt} > ${staleDate.toISOString()}`)
          }

          const branchList = await db.query.branches.findMany({
            where: and(...conditions),
            orderBy: desc(branches.lastSeenAt),
            limit,
            offset: (page - 1) * limit,
          })

          return Response.json(branchList)
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
