import { db, repositories, userInstallations } from '@overlap/db'
import { eq, and, inArray, sql } from 'drizzle-orm'
import type { AuthUser } from './auth'

// Helper to get user's installation IDs (via many-to-many join table)
export async function getUserInstallationIds(userId: string): Promise<string[]> {
  const links = await db.query.userInstallations.findMany({
    where: eq(userInstallations.userId, userId),
    with: { installation: true },
  })
  return links
    .filter((l) => l.installation.status === 'active')
    .map((l) => l.installationId)
}

// Helper to verify the authenticated user has access to a repository
export async function requireRepoAccess(
  user: AuthUser,
  repoId: string
): Promise<typeof repositories.$inferSelect> {
  const installationIds = await getUserInstallationIds(user.id)
  const repo = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.id, repoId),
      installationIds.length > 0
        ? inArray(repositories.installationId, installationIds)
        : sql`false`
    ),
  })
  if (!repo) {
    throw new Response(JSON.stringify({ error: 'Repository not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  return repo
}
