import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

const rawApiUrl = process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:3001'
const apiUrl = rawApiUrl.startsWith('http') ? rawApiUrl : `https://${rawApiUrl}`

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/auth': apiUrl,
      '/api': apiUrl,
    },
  },
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    tanstackStart(),
    nitro({
      preset: 'node_server',
      routeRules: {
        '/auth/**': { proxy: { to: `${apiUrl}/auth/**`, fetchOptions: { redirect: 'manual' } } },
        '/api/**': { proxy: `${apiUrl}/api/**` },
      },
    }),
    viteReact(),
  ],
})
