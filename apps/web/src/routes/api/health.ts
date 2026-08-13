import { createFileRoute } from '@tanstack/react-router'
import { db } from '@overlap/db'
import { sql } from 'drizzle-orm'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        let database = false
        try {
          await db.execute(sql`SELECT 1`)
          database = true
        } catch {
          database = false
        }

        return Response.json(
          {
            status: database ? 'ready' : 'not ready',
            checks: { database },
            timestamp: new Date().toISOString(),
          },
          { status: database ? 200 : 503 }
        )
      },
    },
  },
})
