import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost/test',
    },
  },
})
