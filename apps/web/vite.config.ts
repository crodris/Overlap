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
    }),
    viteReact(),
  ],
})
