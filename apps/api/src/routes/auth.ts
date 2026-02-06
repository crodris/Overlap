import type { FastifyInstance } from 'fastify'
import { db, users, githubAppInstallations } from '@overlap/db'
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
  fastify.get<{ Querystring: { code?: string; state?: string } }>(
    '/github/callback',
    async (request, reply) => {
      const { code, state } = githubOAuthCallbackSchema.parse(request.query)

      // Verify state (CSRF protection)
      const stateCookie = request.cookies.oauth_state
      if (!stateCookie) {
        return reply.status(400).send({ error: 'Missing OAuth state cookie' })
      }

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
