import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { start } from 'workflow/api'
import { isAuthorizedCron } from '../../../lib/cron-auth'
import { pruneBranchesWorkflow } from '../../../workflows/maintenance'

// Vercel Cron hits this on a schedule (see vercel.json). `pruneStaleBranches`
// iterates every active repository, so its runtime scales with the number of
// installations and must not be bounded by a single function invocation.
// This route only authorizes and starts the durable workflow run; it does
// not wait for it to finish.
export const Route = createFileRoute('/api/cron/prune-branches')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorizedCron(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const run = await start(pruneBranchesWorkflow, [])

        return json({ success: true, runId: run.runId })
      },
    },
  },
})
