/**
 * Seed data for the workflow integration tests.
 *
 * These go into a real Postgres through the real schema, so anything the
 * steps' queries rely on - foreign keys, unique indexes, defaults - has to
 * actually hold.
 */

import { eq } from 'drizzle-orm'
import type { Harness } from './harness.js'

export const REPO_GITHUB_ID = 424_242
export const INSTALLATION_ID = 999
export const REPO_FULL_NAME = 'acme/widgets'
export const DEFAULT_BRANCH = 'main'
export const PUSHED_BRANCH = 'feature/checkout'
export const HEAD_SHA = 'b'.repeat(40)

/** A `push` payload GitHub would send, shaped to pass `pushEventSchema`. */
export function pushPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ref: `refs/heads/${PUSHED_BRANCH}`,
    before: 'a'.repeat(40),
    after: HEAD_SHA,
    repository: {
      id: REPO_GITHUB_ID,
      name: 'widgets',
      full_name: REPO_FULL_NAME,
      default_branch: DEFAULT_BRANCH,
      private: false,
    },
    sender: { id: 4242, login: 'octocat' },
    installation: { id: INSTALLATION_ID },
    commits: [
      {
        id: HEAD_SHA,
        added: ['src/checkout.ts'],
        modified: ['src/shared.ts'],
        removed: [],
      },
    ],
    ...overrides,
  }
}

export type SeededRepo = {
  repositoryId: string
  pushedBranchId: string
}

/**
 * A repository with one installation and the branch the push targets.
 *
 * The pushed branch is seeded with an *empty* file index on purpose: that is
 * what lets the ordering test tell "detection ran after the sync" apart from
 * "detection ran at some point". Detection short-circuits on a branch with no
 * tracked files, so any overlap it reports can only have come from an index
 * `syncBranchFiles` had already written.
 */
export async function seedRepository(harness: Harness): Promise<SeededRepo> {
  const { db, schema } = harness

  const [installation] = await db
    .insert(schema.githubAppInstallations)
    .values({ installationId: INSTALLATION_ID, status: 'active' })
    .returning()

  const [repository] = await db
    .insert(schema.repositories)
    .values({
      githubId: REPO_GITHUB_ID,
      installationId: installation.id,
      name: 'widgets',
      fullName: REPO_FULL_NAME,
      defaultBranch: DEFAULT_BRANCH,
    })
    .returning()

  const [pushedBranch] = await db
    .insert(schema.branches)
    .values({
      repositoryId: repository.id,
      name: PUSHED_BRANCH,
      sha: 'a'.repeat(40),
      isDefault: false,
      lastPusherGithubId: 4242,
      lastSeenAt: new Date(),
    })
    .returning()

  return { repositoryId: repository.id, pushedBranchId: pushedBranch.id }
}

/** Another active branch in the repository, with a file index of its own. */
export async function seedBranchWithFiles(
  harness: Harness,
  repositoryId: string,
  name: string,
  filePaths: string[]
): Promise<string> {
  const { db, schema } = harness

  const [branch] = await db
    .insert(schema.branches)
    .values({
      repositoryId,
      name,
      sha: 'c'.repeat(40),
      isDefault: false,
      lastPusherGithubId: 7,
      lastSeenAt: new Date(),
    })
    .returning()

  if (filePaths.length > 0) {
    await db.insert(schema.branchFiles).values(
      filePaths.map((filePath) => ({
        branchId: branch.id,
        filePath,
        changeType: 'modified',
      }))
    )
  }

  return branch.id
}

export async function seedOpenPullRequest(
  harness: Harness,
  repositoryId: string,
  branchId: string,
  githubPrNumber: number
): Promise<string> {
  const { db, schema } = harness

  const [pullRequest] = await db
    .insert(schema.pullRequests)
    .values({
      repositoryId,
      branchId,
      githubPrNumber,
      title: `PR #${githubPrNumber}`,
      state: 'open',
    })
    .returning()

  return pullRequest.id
}

export async function seedWebhookDelivery(
  harness: Harness,
  deliveryId: string,
  payload: Record<string, unknown>,
  eventType = 'push'
): Promise<void> {
  const { db, schema } = harness

  await db.insert(schema.webhookEvents).values({
    eventType,
    deliveryId,
    payload,
    dispatchedAt: new Date(),
  })
}

export async function webhookEventRow(harness: Harness, deliveryId: string) {
  const { db, schema } = harness
  return db.query.webhookEvents.findFirst({
    where: eq(schema.webhookEvents.deliveryId, deliveryId),
  })
}
