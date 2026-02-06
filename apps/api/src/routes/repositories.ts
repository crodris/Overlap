import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { db, repositories, branches, overlaps, repositorySettings, githubAppInstallations } from '@overlap/db'
import { eq, and, desc, count, sql, inArray } from 'drizzle-orm'
import {
  repositoryIdParamSchema,
  repositorySettingsUpdateSchema,
  branchQuerySchema,
  overlapQuerySchema,
  overlapUpdateSchema,
} from '@overlap/shared'
import { requireAuth } from '../plugins/auth.js'

export async function repositoriesRoute(fastify: FastifyInstance) {
  // All repository routes require authentication
  fastify.addHook('preHandler', requireAuth)

  // Helper to get user's installation IDs
  async function getUserInstallationIds(userId: string): Promise<string[]> {
    const installations = await db.query.githubAppInstallations.findMany({
      where: and(
        eq(githubAppInstallations.userId, userId),
        eq(githubAppInstallations.status, 'active')
      ),
      columns: { id: true },
    })
    return installations.map((i) => i.id)
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
        conditions.push(sql`${branches.lastSeenAt} > ${staleDate}`)
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
}
