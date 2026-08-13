/**
 * Test-only stand-in for `@overlap/db`.
 *
 * `build-shims.ts` bundles this file to
 * `.workflow-vitest/node_modules/@overlap/db/index.mjs`, which Node resolves
 * ahead of the real workspace package when it loads the generated step
 * bundle. See `build-shims.ts` for why that is the seam.
 *
 * The schema, the relations and every query the steps issue are the real
 * thing: the only substitution is the connection. Instead of the postgres.js
 * socket client in `packages/db/src/client.ts` this points drizzle at PGlite,
 * a WebAssembly build of Postgres that runs inside the test process, and
 * applies the project's own `packages/db/drizzle/*.sql` migrations to it. The
 * steps therefore execute their real SQL - including the raw `sql` templates
 * in `detectOverlaps` and the relational `with:` loads - against the real
 * schema, with no query faking anywhere.
 *
 * `@electric-sql/pglite` is deliberately a devDependency of the **workspace
 * root**, not of this app. It is an optional peer of drizzle-orm, and pnpm
 * keys a package instance by its resolved peer set - so declaring it in any
 * individual package gives that package its own drizzle-orm variant, and the
 * schema ends up built by one copy and queried by another. At the root,
 * pnpm's `resolve-peers-from-workspace-root` satisfies the peer identically
 * for every workspace project, so `apps/web`, `apps/api`, `apps/worker` and
 * `packages/db` all share a single drizzle-orm. Do not move it into a package
 * manifest: `pnpm typecheck` at the repo root will fail with
 * "Types have separate declarations of a private property 'shouldInlineParams'".
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '@overlap/db/schema'

export * from '@overlap/db/schema'

/** Absolute path to `packages/db/drizzle`, injected by `build-shims.ts`. */
declare const __OVERLAP_MIGRATIONS_DIR__: string

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

export type DbHarness = {
  pglite: PGlite
  db: TestDatabase
  schema: typeof schema
  /** Empties every table. Call between tests. */
  reset(): Promise<void>
}

async function migrate(pglite: PGlite): Promise<void> {
  const files = (await readdir(__OVERLAP_MIGRATIONS_DIR__))
    .filter((file) => file.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const contents = await readFile(join(__OVERLAP_MIGRATIONS_DIR__, file), 'utf8')

    // drizzle-kit separates statements with this marker rather than `;`,
    // because a statement may legitimately contain one.
    for (const statement of contents.split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (trimmed) {
        await pglite.exec(trimmed)
      }
    }
  }
}

async function createHarness(): Promise<DbHarness> {
  const pglite = new PGlite()
  await pglite.waitReady
  await migrate(pglite)

  const db = drizzle(pglite, { schema })

  return {
    pglite,
    db,
    schema,
    async reset() {
      // TRUNCATE rather than re-running the migrations: it is a great deal
      // faster and leaves the schema, indexes and constraints in place.
      await pglite.exec(`
        DO $$
        DECLARE target RECORD;
        BEGIN
          FOR target IN
            SELECT tablename FROM pg_tables WHERE schemaname = 'public'
          LOOP
            EXECUTE 'TRUNCATE TABLE ' || quote_ident(target.tablename) || ' CASCADE';
          END LOOP;
        END $$;
      `)
    },
  }
}

/**
 * One database per worker process, no matter how many module graphs load this
 * file. The step bundle imports it natively while `harness.ts` may reach it
 * through Vitest's module runner; without this rendezvous the tests would seed
 * one Postgres instance and the steps would query another.
 */
const KEY = '__overlapDbHarness__'
const scope = globalThis as unknown as Record<string, Promise<DbHarness>>
scope[KEY] ??= createHarness()

export const __harness: DbHarness = await scope[KEY]
export const db: TestDatabase = __harness.db
