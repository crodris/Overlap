import { createFileRoute } from '@tanstack/react-router'
import { SignJWT } from 'jose'

export const Route = createFileRoute('/api/auth/github')({
  server: {
    handlers: {
      GET: async () => {
        const clientId = process.env.GITHUB_CLIENT_ID
        const appUrl = process.env.APP_URL || 'http://localhost:3000'
        if (!clientId) {
          return new Response('OAuth not configured', { status: 500 })
        }

        const state = crypto.randomUUID()

        // The state cookie is signed, not merely present, per spec S7.
        const stateToken = await new SignJWT({ state })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('10m')
          .sign(new TextEncoder().encode(process.env.SESSION_SECRET!))

        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: `${appUrl}/api/auth/github/callback`,
          scope: 'read:user user:email',
          state,
        })

        const cookieParts = [
          `oauth_state=${stateToken}`,
          'HttpOnly',
          'SameSite=Lax',
          'Path=/',
          'Max-Age=600',
        ]
        if (process.env.NODE_ENV === 'production') cookieParts.push('Secure')

        return new Response(null, {
          status: 302,
          headers: {
            location: `https://github.com/login/oauth/authorize?${params}`,
            'set-cookie': cookieParts.join('; '),
          },
        })
      },
    },
  },
})
