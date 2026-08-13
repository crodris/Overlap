import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import { workflow } from 'workflow/vite'

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
  },
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    workflow(),
    tanstackStart({
      router: {
        // `github-handler.ts` and its `__tests__` directory live under
        // `src/routes/api/webhooks/` deliberately: `github-handler.ts` is
        // imported by path from both `github.ts` (the actual route file)
        // and `__tests__/verify-order.test.ts`, and moving it out of
        // `routes/` would break that relative import. Neither exports a
        // `Route`, so the file-based router would otherwise warn about both
        // on every build and dev start.
        routeFileIgnorePattern: '(github-handler\\.ts|^__tests__$)',
      },
    }),
    nitro({
      preset: 'vercel',
      // The whole app (SSR pages, every /api route, and the two cron
      // triggers) is built into a single `__server` Vercel Function, so this
      // is the only duration lever that exists for this deployment.
      //
      // The root vercel.json `functions` block does NOT reach this function:
      // the Vercel "vercel" Nitro preset writes `.vc-config.json` straight
      // from this `vercel.functions` option (see
      // `generateFunctionFiles`/`resolveVercelRuntime` in
      // `nitro/dist/_presets.mjs`), and it only reads the root vercel.json to
      // check `bunVersion`. A `functions` glob in vercel.json would sit next
      // to this file looking authoritative while silently doing nothing -
      // confirmed by rebuilding with such a block present and finding
      // `maxDuration` absent from the built `.vc-config.json`.
      //
      // 120s (Pro/Fluid default is 300s) is below the platform default, but
      // it is NOT sized against the request path alone. Vercel Workflow
      // steps ('use step' functions in apps/web/src/workflows/steps.ts) run
      // as invocations of this same __server function - see "A step is one
      // function invocation" in steps.ts - so this budget bounds every step,
      // not just an SSR render, a Drizzle query, or a `start()` call that
      // hands off to a workflow run and returns immediately.
      //
      // The worst-case step is `syncRepository`: it paginates
      // octokit.repos.listBranches at per_page: 100 (packages/github/src/
      // client.ts), which for a repository with a few thousand branches is
      // on the order of 30-50 sequential GitHub API pages. Its database
      // writes were previously one UPDATE-or-INSERT per branch, which alone
      // could exceed 60s on a large repository (see the batching in
      // `syncRepository`); that per-branch loop is now two set-based
      // statements, so the dominant remaining cost is the sequential GitHub
      // pagination itself. At normal GitHub latency that comfortably fits in
      // 60s, but 120s is used instead to leave headroom for larger
      // repositories and slower GitHub responses without moving all the way
      // up to the 300s platform default, which would let a genuine hang - a
      // wedged DB connection, an unbounded loop - run five times longer than
      // necessary.
      vercel: {
        functions: {
          maxDuration: 120,
        },
      },
    }),
    viteReact(),
  ],
})
