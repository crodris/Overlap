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
      // 60s (Pro/Fluid default is 300s) is deliberately below the platform
      // default: every request this function serves is meant to be fast -
      // an SSR render, a handful of Drizzle queries, at most one GitHub API
      // call (diff fetch or OAuth token exchange), or a `start()` call that
      // hands off to a durable workflow run and returns immediately without
      // waiting on it. 60s leaves generous headroom (~6x) over that expected
      // path while capping the cost/blast-radius of a genuine hang - a
      // wedged DB connection, an unbounded loop - to a fraction of the
      // platform default instead of letting it run for 5 to 30 minutes.
      vercel: {
        functions: {
          maxDuration: 60,
        },
      },
    }),
    viteReact(),
  ],
})
