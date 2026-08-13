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
    tanstackStart(),
    nitro({
      preset: 'vercel',
    }),
    viteReact(),
  ],
})
