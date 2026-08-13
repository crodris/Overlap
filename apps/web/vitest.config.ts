import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests live in `test/` and need the workflow runtime that
    // only `vitest.integration.config.ts` sets up. Excluded by name as well
    // as by directory so a stray file cannot end up in both suites.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost/test',
    },
  },
})
