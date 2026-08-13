/**
 * Vitest `globalSetup` that installs the test doubles the workflow integration
 * tests need for `@overlap/db` and `@overlap/github`.
 *
 * Why this exists rather than `vi.mock()` or a Vitest alias:
 *
 * `@workflow/vitest` does not run steps through Vitest's module graph. Before
 * the suite starts it esbuild-bundles every `"use step"` function into
 * `.workflow-vitest/steps.mjs` and the worker imports that bundle with a plain
 * `import()`. Vitest never sees it, so `vi.mock()` and `resolve.alias` have no
 * effect on it - a point the SDK's own testing guide makes.
 *
 * The bundler leaves bare package specifiers alone (`steps.mjs` still contains
 * `import { db, branches, ... } from "@overlap/db"`), so those imports are
 * resolved by Node at runtime, from the directory the bundle sits in. Node
 * looks in `.workflow-vitest/node_modules` before `apps/web/node_modules`, so
 * dropping a package there shadows the workspace one for the step bundle only.
 * Nothing outside `.workflow-vitest/` is affected, and no production code
 * changes to make the steps injectable.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(here, '../..')
const repoRoot = resolve(webRoot, '../..')
const shimRoot = join(webRoot, '.workflow-vitest', 'node_modules', '@overlap')
const migrationsDir = join(repoRoot, 'packages', 'db', 'drizzle')

async function writeShimPackage(name: string, entry: string): Promise<void> {
  const outDir = join(shimRoot, name)
  await mkdir(outDir, { recursive: true })

  await writeFile(
    join(outDir, 'package.json'),
    `${JSON.stringify(
      {
        name: `@overlap/${name}`,
        version: '0.0.0-integration-test',
        private: true,
        type: 'module',
        main: './index.mjs',
        // Every subpath the real package exposes maps to the same module, so
        // a step importing `@overlap/db/schema` still gets the shim.
        exports: {
          '.': './index.mjs',
          './schema': './index.mjs',
          './client': './index.mjs',
          './webhooks': './index.mjs',
        },
      },
      null,
      2
    )}\n`
  )

  await build({
    entryPoints: [join(here, entry)],
    outfile: join(outDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    // Kept external so the shim and the step bundle share one copy: drizzle
    // table objects are compared by identity inside a query, and PGlite must
    // not be instantiated twice.
    external: ['drizzle-orm', 'drizzle-orm/*', '@electric-sql/pglite'],
    define: {
      __OVERLAP_MIGRATIONS_DIR__: JSON.stringify(migrationsDir),
    },
    logLevel: 'error',
  })
}

export async function setup(): Promise<void> {
  await writeShimPackage('db', 'db-shim.ts')
  await writeShimPackage('github', 'github-shim.ts')
  await writeShimPackage('shared', 'shared-shim.ts')
}
