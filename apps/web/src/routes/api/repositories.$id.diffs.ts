import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { db, repositories } from '@overlap/db'
import { eq } from 'drizzle-orm'
import { repositoryIdParamSchema, diffQuerySchema } from '@overlap/shared'
import { getGitHubClient } from '@overlap/github'
import { requireUser } from '../../lib/auth'
import { requireRepoAccess } from '../../lib/repo-access'

export const Route = createFileRoute('/api/repositories/$id/diffs')({
  server: {
    handlers: {
      // Get all file diffs between two branches
      GET: async ({ request, params }) => {
        try {
          const user = await requireUser(request)
          const { id } = repositoryIdParamSchema.parse(params)
          const url = new URL(request.url)
          const { base, head } = diffQuerySchema.parse(Object.fromEntries(url.searchParams))

          await requireRepoAccess(user, id)

          const repoWithInstallation = await db.query.repositories.findFirst({
            where: eq(repositories.id, id),
            with: { installation: true },
          })

          if (!repoWithInstallation?.installation) {
            return json({ error: 'Installation not found' }, { status: 500 })
          }

          const [owner, name] = repoWithInstallation.fullName.split('/')
          const github = getGitHubClient()

          try {
            const diffs = await github.getCompareDiffs(
              repoWithInstallation.installation.installationId,
              owner,
              name,
              base,
              head
            )

            return json({ files: diffs })
          } catch (error: unknown) {
            const err = error as { status?: number; message?: string }
            if (err.status === 404) {
              return json({ error: 'Branch no longer exists' }, { status: 404 })
            }
            throw error
          }
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
