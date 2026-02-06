import type { FastifyInstance } from 'fastify'
import { db, users, githubAppInstallations, repositories, repositorySettings } from '@overlap/db'
import { eq, and } from 'drizzle-orm'
import { githubOAuthCallbackSchema } from '@overlap/shared'
import { requireAuth } from '../plugins/auth.js'

export async function authRoute(fastify: FastifyInstance) {
  const clientId = process.env.GITHUB_CLIENT_ID
  const clientSecret = process.env.GITHUB_CLIENT_SECRET
  const apiUrl = process.env.API_URL || 'http://localhost:3001'
  const appUrl = process.env.APP_URL || 'http://localhost:3000'

  if (!clientId || !clientSecret) {
    fastify.log.warn('GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set — auth routes disabled')
    return
  }

  // Redirect to GitHub OAuth
  fastify.get('/github', async (request, reply) => {
    const state = crypto.randomUUID()

    reply.setCookie('oauth_state', state, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600, // 10 minutes
    })

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${apiUrl}/auth/github/callback`,
      scope: 'read:user user:email',
      state,
    })

    return reply.redirect(`https://github.com/login/oauth/authorize?${params}`)
  })

  // GitHub OAuth callback
  fastify.get<{ Querystring: { code?: string; state?: string; setup_action?: string } }>(
    '/github/callback',
    async (request, reply) => {
      // If this callback came from a GitHub App installation flow (no state cookie),
      // redirect through our own OAuth flow to establish CSRF protection.
      // GitHub will auto-approve since the user already authorized.
      const stateCookie = request.cookies.oauth_state
      if (!stateCookie) {
        return reply.redirect(`${apiUrl}/auth/github`)
      }

      const { code, state } = githubOAuthCallbackSchema.parse(request.query)

      // Verify state (CSRF protection) — always enforced
      const unsigned = request.unsignCookie(stateCookie)
      if (!unsigned.valid || unsigned.value !== state) {
        return reply.status(400).send({ error: 'Invalid OAuth state' })
      }

      // Exchange code for access token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      })

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string
        error?: string
      }

      if (!tokenData.access_token) {
        fastify.log.error({ tokenData }, 'Failed to exchange code for token')
        return reply.status(400).send({ error: 'Failed to exchange code for token' })
      }

      // Fetch user profile
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github+json',
        },
      })

      const githubUser = (await userResponse.json()) as {
        id: number
        login: string
        email: string | null
        avatar_url: string
      }

      // Upsert user
      const [user] = await db
        .insert(users)
        .values({
          githubId: githubUser.id,
          username: githubUser.login,
          email: githubUser.email,
          avatarUrl: githubUser.avatar_url,
        })
        .onConflictDoUpdate({
          target: users.githubId,
          set: {
            username: githubUser.login,
            email: githubUser.email,
            avatarUrl: githubUser.avatar_url,
            updatedAt: new Date(),
          },
        })
        .returning()

      // Set session cookie
      reply.setCookie(
        'session',
        JSON.stringify({ userId: user.id }),
        {
          signed: true,
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 60 * 60 * 24 * 7, // 7 days
        }
      )

      // Clear oauth_state cookie
      reply.clearCookie('oauth_state', { path: '/' })

      // Sync user's GitHub App installations into local DB
      await syncUserInstallations(tokenData.access_token, user.id)

      // Check if user has installations
      const installation = await db.query.githubAppInstallations.findFirst({
        where: and(
          eq(githubAppInstallations.userId, user.id),
          eq(githubAppInstallations.status, 'active')
        ),
      })

      if (!installation) {
        return reply.redirect(`${appUrl}?setup=1`)
      }

      return reply.redirect(appUrl)
    }
  )

  // Get current user
  fastify.get('/me', { preHandler: [requireAuth] }, async (request) => {
    const installation = await db.query.githubAppInstallations.findFirst({
      where: and(
        eq(githubAppInstallations.userId, request.user!.id),
        eq(githubAppInstallations.status, 'active')
      ),
    })

    return {
      user: request.user,
      hasInstallations: !!installation,
    }
  })

  // Logout
  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('session', { path: '/' })
    return { success: true }
  })
}

async function syncUserInstallations(accessToken: string, userId: string) {
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
            userId,
            status: 'active',
            updatedAt: new Date(),
          },
        })
        .returning()

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
