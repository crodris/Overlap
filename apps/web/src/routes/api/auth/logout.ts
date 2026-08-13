import { createFileRoute } from '@tanstack/react-router'
import { buildClearCookie } from '../../../lib/auth'
import { SESSION_COOKIE_NAME } from '../../../lib/session'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async () => {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': buildClearCookie(SESSION_COOKIE_NAME),
          },
        })
      },
    },
  },
})
