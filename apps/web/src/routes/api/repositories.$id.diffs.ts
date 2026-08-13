import { createFileRoute } from '@tanstack/react-router'
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
            return Response.json({ error: 'Installation not found' }, { status: 500 })
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

            return Response.json({ files: diffs })
          } catch (error: unknown) {
            // This route is not a workflow step, so it gets no retry and no
            // `classifyGitHubError` (that helper returns `FatalError` /
            // `RetryableError`, which only mean something to the workflow
            // runtime - throwing one here would just be an unhandled
            // rejection with extra steps). It has to translate GitHub's
            // error shape into an HTTP response itself. Octokit's
            // rate-limit and secondary-rate-limit responses both come back
            // as 403 or 429; without handling them explicitly they fall
            // through to `throw error` below and surface to the client as
            // an unhandled 500 instead of a response it can act on.
            const err = error as {
              status?: number
              message?: string
              response?: { headers?: Record<string, string | undefined> }
            }
            if (err.status === 404) {
              return Response.json({ error: 'Branch no longer exists' }, { status: 404 })
            }
            if (err.status === 403 || err.status === 429) {
              const retryAfter = err.response?.headers?.['retry-after']
              return Response.json(
                { error: 'GitHub rate limit exceeded, please try again shortly' },
                {
                  status: 429,
                  ...(retryAfter ? { headers: { 'Retry-After': retryAfter } } : {}),
                }
              )
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
