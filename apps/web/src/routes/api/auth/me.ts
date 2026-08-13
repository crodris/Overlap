import { createFileRoute } from '@tanstack/react-router'
import { db, userInstallations } from '@overlap/db'
import { eq } from 'drizzle-orm'
import { requireUser } from '../../../lib/auth'

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const user = await requireUser(request)
          const insts = await db.query.userInstallations.findMany({
            where: eq(userInstallations.userId, user.id),
            with: { installation: true },
          })
          return Response.json({
            user,
            hasInstallations: insts.some(
              (ui) => ui.installation.status === 'active'
            ),
          })
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
