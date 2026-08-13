import { createFileRoute } from '@tanstack/react-router'
import { db, repositorySettings } from '@overlap/db'
import { eq } from 'drizzle-orm'
import { repositoryIdParamSchema, repositorySettingsUpdateSchema } from '@overlap/shared'
import { requireUser } from '../../lib/auth'
import { requireRepoAccess } from '../../lib/repo-access'

export const Route = createFileRoute('/api/repositories/$id/settings')({
  server: {
    handlers: {
      // Update repository settings
      PATCH: async ({ request, params }) => {
        try {
          const user = await requireUser(request)
          const { id } = repositoryIdParamSchema.parse(params)
          const updates = repositorySettingsUpdateSchema.parse(await request.json())

          await requireRepoAccess(user, id)

          const [updated] = await db
            .update(repositorySettings)
            .set({
              ...updates,
              updatedAt: new Date(),
            })
            .where(eq(repositorySettings.repositoryId, id))
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
