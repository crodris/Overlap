import { createFileRoute } from '@tanstack/react-router'
import { start } from 'workflow/api'
import { handleWebhook } from './github-handler'

// `start` is overloaded (it also accepts a `deploymentId` option as a third
// argument). `handleWebhook`'s injected `Deps.start` intentionally narrows
// that down to the one shape this route ever calls it with, so the ordering
// can be unit tested without importing the workflow runtime. This cast
// bridges the two: the call below always matches the real signature.
const startWorkflow = start as unknown as (wf: unknown, args: unknown[]) => Promise<unknown>

export const Route = createFileRoute('/api/webhooks/github')({
  server: {
    handlers: {
      POST: async ({ request }) => handleWebhook(request, { start: startWorkflow }),
    },
  },
})
