import { createFileRoute } from '@tanstack/react-router'
import { start } from 'workflow/api'
import { isAuthorizedCron } from '../../../lib/cron-auth'
import { pruneBranchesWorkflow } from '../../../workflows/maintenance'

// Vercel Cron hits this on a schedule (see vercel.json). `pruneBranchesWorkflow`
// fans out one durable step per active repository (`pruneRepositoryBranches`),
// so its total runtime scales with the number of installations without any
// single step - or this route's own invocation - needing to cover all of
// them. This route only authorizes and starts the durable workflow run; it
// does not wait for it to finish.
export const Route = createFileRoute('/api/cron/prune-branches')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorizedCron(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const run = await start(pruneBranchesWorkflow, [])

        return Response.json({ success: true, runId: run.runId })
      },
    },
  },
})
