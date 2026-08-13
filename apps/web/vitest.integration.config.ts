import { defineConfig } from 'vitest/config'
import { workflow } from '@workflow/vitest'

/**
 * Integration tests for the durable workflow.
 *
 * `workflow()` compiles the `"use workflow"` / `"use step"` directives,
 * bundles the workflow and step entry points, and runs them against an
 * in-process Local World - so `start()` here exercises the real runtime:
 * real step dispatch, real event log, real failure semantics.
 *
 * It is a separate config from `vitest.config.ts` on purpose. The plugin
 * builds those bundles before the suite starts, which the unit tests neither
 * need nor should pay for, and the two suites are kept apart by file name:
 * `*.integration.test.ts` here, `src/**\/*.test.ts` there.
 */
export default defineConfig({
  plugins: [workflow()],
  test: {
    include: ['test/**/*.integration.test.ts'],
    environment: 'node',
    // A run boots PGlite, applies migrations and executes a chain of steps.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Installs the `@overlap/db` / `@overlap/github` doubles the step bundle
    // resolves at runtime. Runs alongside the plugin's own global setup.
    globalSetup: ['./test/integration/build-shims.ts'],
    // Repairs a JSON import in the SDK's generated bundle. Must run after the
    // plugin's global setup has written it, which is why it is a setup file.
    setupFiles: ['./test/integration/patch-step-bundle.ts'],
    env: {
      // `packages/db/src/client.ts` throws at import time without this. The
      // step bundle never reaches that file (see `build-shims.ts`), but other
      // modules in the graph import `@overlap/db` normally.
      DATABASE_URL: 'postgresql://test:test@localhost/test',
    },
  },
})
