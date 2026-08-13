import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { db, users, userInstallations } from '@overlap/db'
import { eq } from 'drizzle-orm'
import { githubOAuthCallbackSchema } from '@overlap/shared'
import { jwtVerify } from 'jose'
import { signSession } from '../../../lib/session'
import { readCookie, buildSessionCookie, buildClearCookie } from '../../../lib/auth'
import { syncUserInstallations } from '../../../lib/github-oauth'

const clientId = process.env.GITHUB_CLIENT_ID
const clientSecret = process.env.GITHUB_CLIENT_SECRET
const appUrl = process.env.APP_URL || 'http://localhost:3000'

export const Route = createFileRoute('/api/auth/github/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // If this callback came from a GitHub App installation flow (no state cookie),
        // redirect through our own OAuth flow to establish CSRF protection.
        // GitHub will auto-approve since the user already authorized.
        const stateCookie = readCookie(request, 'oauth_state')
        if (!stateCookie) {
          return new Response(null, {
            status: 302,
            headers: { location: `${appUrl}/api/auth/github` },
          })
        }

        const url = new URL(request.url)
        const { code, state } = githubOAuthCallbackSchema.parse({
          code: url.searchParams.get('code') ?? undefined,
          state: url.searchParams.get('state') ?? undefined,
        })

        // Verify state (CSRF protection) — always enforced. The state cookie is
        // itself a signed JWT (per spec S7), so verification checks integrity,
        // not merely presence.
        let stateClaim: unknown
        try {
          const { payload } = await jwtVerify(stateCookie, new TextEncoder().encode(process.env.SESSION_SECRET!), {
            algorithms: ['HS256'],
          })
          stateClaim = payload.state
        } catch {
          return json({ error: 'Invalid OAuth state' }, { status: 400 })
        }
        if (typeof stateClaim !== 'string' || stateClaim !== state) {
          return json({ error: 'Invalid OAuth state' }, { status: 400 })
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
          return json({ error: 'Failed to exchange code for token' }, { status: 400 })
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

        const headers = new Headers()
        headers.append('set-cookie', buildSessionCookie(await signSession(user.id)))
        headers.append('set-cookie', buildClearCookie('oauth_state'))

        // Sync user's GitHub App installations into local DB
        await syncUserInstallations(tokenData.access_token, user.id)

        // Check if user has any active installations
        const userInsts = await db.query.userInstallations.findMany({
          where: eq(userInstallations.userId, user.id),
          with: { installation: true },
        })
        const hasActive = userInsts.some((ui) => ui.installation.status === 'active')

        headers.set('location', hasActive ? appUrl : `${appUrl}?setup=1`)

        return new Response(null, { status: 302, headers })
      },
    },
  },
})
