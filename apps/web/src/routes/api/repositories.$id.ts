import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { db, repositories } from '@overlap/db'
import { eq } from 'drizzle-orm'
import { repositoryIdParamSchema } from '@overlap/shared'
import { requireUser } from '../../lib/auth'
import { requireRepoAccess } from '../../lib/repo-access'

export const Route = createFileRoute('/api/repositories/$id')({
  server: {
    handlers: {
      // Get repository by ID (scoped to user's installations)
      GET: async ({ request, params }) => {
        try {
          const user = await requireUser(request)
          const { id } = repositoryIdParamSchema.parse(params)
          await requireRepoAccess(user, id)

          // Re-query with relations for the detail view
          const repoWithRelations = await db.query.repositories.findFirst({
            where: eq(repositories.id, id),
            with: {
              settings: true,
              installation: true,
            },
          })

          return json(repoWithRelations)
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
