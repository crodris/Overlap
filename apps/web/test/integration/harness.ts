/**
 * Test-side access to the doubles installed by `build-shims.ts`.
 *
 * The step bundle imports the database shim natively, from a path Vitest never
 * sees, while this file reaches it through Vitest's module runner. Both must
 * end up talking to the same Postgres instance. Vitest externalizes anything
 * under a `node_modules` directory, and the shim is installed under one, so in
 * practice both land on the same module - but the shim also parks its state on
 * `globalThis`, so a second evaluation would still share one database.
 */

import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type * as dbSchema from '@overlap/db/schema'
import {
  getGitHubFakeState,
  resetGitHubFakeState,
  type GitHubFakeState,
} from './github-state.js'

export type { GitHubFakeState }

export type Schema = typeof dbSchema

export type Harness = {
  db: PgliteDatabase<Schema>
  schema: Schema
  /** Empties every table. */
  reset(): Promise<void>
}

const shimUrl = pathToFileURL(
  join(
    resolve(import.meta.dirname, '../..'),
    '.workflow-vitest',
    'node_modules',
    '@overlap',
    'db',
    'index.mjs'
  )
).href

let cached: Harness | undefined

/**
 * Boots (on first call) and returns the in-process Postgres the steps query.
 *
 * Loading it here, before any workflow starts, is what makes seeding possible:
 * the step bundle would otherwise not be imported until the first step runs.
 */
export async function getHarness(): Promise<Harness> {
  if (!cached) {
    const shim = (await import(/* @vite-ignore */ shimUrl)) as Record<
      string,
      unknown
    >
    cached = shim.__harness as Harness
  }
  return cached
}

/** Clears the database and the recorded GitHub calls. */
export async function resetHarness(): Promise<Harness> {
  const harness = await getHarness()
  await harness.reset()
  resetGitHubFakeState()
  return harness
}

export function github(): GitHubFakeState {
  return getGitHubFakeState()
}
