import { createFileRoute } from '@tanstack/react-router'
import { start } from 'workflow/api'
import { isAuthorizedCron } from '../../../lib/cron-auth'
import { cleanupEventsWorkflow } from '../../../workflows/maintenance'

// Vercel Cron hits this on a schedule (see vercel.json). This route only
// authorizes and starts the durable workflow run; it does not wait for it
// to finish.
export const Route = createFileRoute('/api/cron/cleanup-events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorizedCron(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const run = await start(cleanupEventsWorkflow, [])

        return Response.json({ success: true, runId: run.runId })
      },
    },
  },
})
