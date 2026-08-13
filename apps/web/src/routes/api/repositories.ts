import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { db, repositories, branches, overlaps } from '@overlap/db'
import { eq, and, desc, count, inArray } from 'drizzle-orm'
import { requireUser } from '../../lib/auth'
import { getUserInstallationIds } from '../../lib/repo-access'

export const Route = createFileRoute('/api/repositories')({
  server: {
    handlers: {
      // List repositories (scoped to user's installations)
      GET: async ({ request }) => {
        try {
          const user = await requireUser(request)
          const installationIds = await getUserInstallationIds(user.id)

          if (installationIds.length === 0) {
            return json([])
          }

          const repos = await db.query.repositories.findMany({
            where: and(
              eq(repositories.isActive, true),
              inArray(repositories.installationId, installationIds)
            ),
            with: {
              settings: true,
            },
            orderBy: desc(repositories.updatedAt),
          })

          // Get summary stats for each repo
          const results = await Promise.all(
            repos.map(async (repo) => {
              const [branchCount] = await db
                .select({ count: count() })
                .from(branches)
                .where(and(eq(branches.repositoryId, repo.id), eq(branches.isDefault, false)))

              const [overlapCount] = await db
                .select({ count: count() })
                .from(overlaps)
                .where(and(eq(overlaps.repositoryId, repo.id), eq(overlaps.status, 'active')))

              return {
                id: repo.id,
                name: repo.name,
                fullName: repo.fullName,
                defaultBranch: repo.defaultBranch,
                isPrivate: repo.isPrivate,
                activeBranches: branchCount?.count ?? 0,
                activeOverlaps: overlapCount?.count ?? 0,
                lastSyncedAt: repo.lastSyncedAt,
                settings: repo.settings,
              }
            })
          )

          return json(results)
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
