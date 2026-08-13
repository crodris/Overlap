import { db, githubAppInstallations, userInstallations, repositories, repositorySettings } from '@overlap/db'

export async function syncUserInstallations(accessToken: string, userId: string) {
  try {
    const res = await fetch('https://api.github.com/user/installations', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    })

    if (!res.ok) return

    const data = (await res.json()) as {
      installations: Array<{
        id: number
        account: { login: string; type: string }
      }>
    }

    for (const inst of data.installations) {
      const [installation] = await db
        .insert(githubAppInstallations)
        .values({
          installationId: inst.id,
          userId,
          status: 'active',
        })
        .onConflictDoUpdate({
          target: githubAppInstallations.installationId,
          set: {
            status: 'active',
            updatedAt: new Date(),
          },
        })
        .returning()

      // Link user to installation (many-to-many)
      await db
        .insert(userInstallations)
        .values({ userId, installationId: installation.id })
        .onConflictDoNothing()

      // Sync repos for this installation
      await syncInstallationRepos(accessToken, inst.id, installation.id)
    }
  } catch (err) {
    console.error('Failed to sync installations:', err)
  }
}

async function syncInstallationRepos(accessToken: string, installationId: number, dbInstallationId: string) {
  try {
    const res = await fetch(
      `https://api.github.com/user/installations/${installationId}/repositories`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
        },
      }
    )

    if (!res.ok) return

    const data = (await res.json()) as {
      repositories: Array<{
        id: number
        name: string
        full_name: string
        private: boolean
        default_branch: string
      }>
    }

    for (const repo of data.repositories) {
      const [inserted] = await db
        .insert(repositories)
        .values({
          githubId: repo.id,
          installationId: dbInstallationId,
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
          isPrivate: repo.private,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: repositories.githubId,
          set: {
            installationId: dbInstallationId,
            name: repo.name,
            fullName: repo.full_name,
            defaultBranch: repo.default_branch,
            isPrivate: repo.private,
            isActive: true,
            updatedAt: new Date(),
          },
        })
        .returning()

      // Ensure default settings exist
      await db
        .insert(repositorySettings)
        .values({ repositoryId: inserted.id })
        .onConflictDoNothing()
    }
  } catch (err) {
    console.error(`Failed to sync repos for installation ${installationId}:`, err)
  }
}
