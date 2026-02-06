import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { db, repositories, branches, overlaps, repositorySettings, githubAppInstallations, userInstallations } from '@overlap/db'
import { eq, and, desc, count, sql, inArray } from 'drizzle-orm'
import {
  repositoryIdParamSchema,
  repositorySettingsUpdateSchema,
  branchQuerySchema,
  overlapQuerySchema,
  overlapUpdateSchema,
  diffQuerySchema,
} from '@overlap/shared'
import { getGitHubClient } from '@overlap/github'
import { requireAuth } from '../plugins/auth.js'

export async function repositoriesRoute(fastify: FastifyInstance) {
  // All repository routes require authentication
  fastify.addHook('preHandler', requireAuth)

  // Helper to get user's installation IDs (via many-to-many join table)
  async function getUserInstallationIds(userId: string): Promise<string[]> {
    const links = await db.query.userInstallations.findMany({
      where: eq(userInstallations.userId, userId),
      with: { installation: true },
    })
    return links
      .filter((l) => l.installation.status === 'active')
      .map((l) => l.installationId)
  }

  // Helper to verify the authenticated user has access to a repository
  async function requireRepoAccess(request: FastifyRequest, reply: FastifyReply, repoId: string) {
    const installationIds = await getUserInstallationIds(request.user!.id)
    const repo = await db.query.repositories.findFirst({
      where: and(
        eq(repositories.id, repoId),
        installationIds.length > 0
          ? inArray(repositories.installationId, installationIds)
          : sql`false`
      ),
    })
    if (!repo) {
      reply.status(404).send({ error: 'Repository not found' })
      return null
    }
    return repo
  }

  // List repositories (scoped to user's installations)
  fastify.get('/', async (request, reply) => {
    const installationIds = await getUserInstallationIds(request.user!.id)

    if (installationIds.length === 0) {
      return []
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

    return results
  })

  // Get repository by ID (scoped to user's installations)
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = repositoryIdParamSchema.parse(request.params)
    const repo = await requireRepoAccess(request, reply, id)
    if (!repo) return

    // Re-query with relations for the detail view
    const repoWithRelations = await db.query.repositories.findFirst({
      where: eq(repositories.id, id),
      with: {
        settings: true,
        installation: true,
      },
    })

    return repoWithRelations
  })

  // Update repository settings
  fastify.patch<{ Params: { id: string }; Body: unknown }>(
    '/:id/settings',
    async (request, reply) => {
      const { id } = repositoryIdParamSchema.parse(request.params)
      const updates = repositorySettingsUpdateSchema.parse(request.body)

      const repo = await requireRepoAccess(request, reply, id)
      if (!repo) return

      const [updated] = await db
        .update(repositorySettings)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(repositorySettings.repositoryId, id))
        .returning()

      return updated
    }
  )

  // List branches for a repository
  fastify.get<{ Params: { id: string }; Querystring: unknown }>(
    '/:id/branches',
    async (request, reply) => {
      const { id } = repositoryIdParamSchema.parse(request.params)
      const { includeDefault, includeStale, page, limit } = branchQuerySchema.parse(
        request.query
      )

      const repo = await requireRepoAccess(request, reply, id)
      if (!repo) return

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

      return branchList
    }
  )

  // List overlaps for a repository
  fastify.get<{ Params: { id: string }; Querystring: unknown }>(
    '/:id/overlaps',
    async (request, reply) => {
      const { id } = repositoryIdParamSchema.parse(request.params)
      const { status, severity, branchId, page, limit } = overlapQuerySchema.parse(
        request.query
      )

      const repo = await requireRepoAccess(request, reply, id)
      if (!repo) return

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

      return overlapList
    }
  )

  // Get all file diffs between two branches
  fastify.get<{ Params: { id: string }; Querystring: unknown }>(
    '/:id/diffs',
    async (request, reply) => {
      const { id } = repositoryIdParamSchema.parse(request.params)
      const { base, head } = diffQuerySchema.parse(request.query)

      const repo = await requireRepoAccess(request, reply, id)
      if (!repo) return

      const repoWithInstallation = await db.query.repositories.findFirst({
        where: eq(repositories.id, id),
        with: { installation: true },
      })

      if (!repoWithInstallation?.installation) {
        return reply.status(500).send({ error: 'Installation not found' })
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

        return { files: diffs }
      } catch (error: unknown) {
        const err = error as { status?: number; message?: string }
        if (err.status === 404) {
          return reply.status(404).send({ error: 'Branch no longer exists' })
        }
        throw error
      }
    }
  )

  // Update overlap status (resolve/ignore)
  fastify.patch<{ Params: { id: string; overlapId: string }; Body: unknown }>(
    '/:id/overlaps/:overlapId',
    async (request, reply) => {
      const { id } = repositoryIdParamSchema.parse(request.params)
      const overlapId = request.params.overlapId
      const { status } = overlapUpdateSchema.parse(request.body)

      const repo = await requireRepoAccess(request, reply, id)
      if (!repo) return

      const overlap = await db.query.overlaps.findFirst({
        where: and(eq(overlaps.id, overlapId), eq(overlaps.repositoryId, id)),
      })

      if (!overlap) {
        return reply.status(404).send({ error: 'Overlap not found' })
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

      return updated
    }
  )

  // DEV ONLY: Test push notification for an existing overlap
  if (process.env.NODE_ENV !== 'production') {
    fastify.post<{ Params: { id: string; overlapId: string } }>(
      '/:id/overlaps/:overlapId/test-notify',
      async (request, reply) => {
        const { id } = repositoryIdParamSchema.parse(request.params)
        const overlapId = request.params.overlapId

        const repo = await requireRepoAccess(request, reply, id)
        if (!repo) return

        const overlap = await db.query.overlaps.findFirst({
          where: and(eq(overlaps.id, overlapId), eq(overlaps.repositoryId, id)),
          with: { sourceBranch: true, targetBranch: true },
        })

        if (!overlap) {
          return reply.status(404).send({ error: 'Overlap not found' })
        }

        await fastify.queues.pushNotification.add(
          'notify',
          {
            repositoryId: id,
            overlapId,
            targetBranchId: overlap.targetBranchId,
          },
          {
            jobId: `test:${overlapId}:${Date.now()}`,
          }
        )

        return { success: true, message: 'Test notification queued' }
      }
    )
  }
}
