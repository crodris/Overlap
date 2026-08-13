/**
 * Integration tests for `processWebhook`, run against the real workflow
 * runtime via `@workflow/vitest`.
 *
 * These cover the two behaviours the whole migration rests on and that no
 * unit test can reach, because a `"use workflow"` function throws when it is
 * invoked directly:
 *
 *  1. Sync happens-before detect. The BullMQ system enqueued branch sync and
 *     overlap detection as two independent jobs and hoped a `delay: 5000`
 *     would keep them in order. The workflow replaces that with an awaited
 *     edge; this asserts the edge holds at runtime, and - more importantly -
 *     that detection reads the index the sync wrote.
 *  2. Failure bookkeeping. `processWebhook` records the error on the
 *     `webhook_events` row and rethrows. If it did not, a failed delivery
 *     would leave no trace at all.
 *
 * Plus the check-run fan-out, which unions pull request ids so that N
 * overlaps across M pull requests produce M calls rather than N*M.
 */

import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { start } from 'workflow/api'
import { processWebhook } from '../../src/workflows/process-webhook'
import {
  DEFAULT_BRANCH,
  HEAD_SHA,
  INSTALLATION_ID,
  PUSHED_BRANCH,
  REPO_FULL_NAME,
  pushPayload,
  seedBranchWithFiles,
  seedOpenPullRequest,
  seedRepository,
  seedWebhookDelivery,
  webhookEventRow,
} from './fixtures.js'
import { github, resetHarness, type Harness } from './harness.js'
import { countOf, firstIndexOf, stepLog } from './run-events.js'

const OVERLAPPING_FILES = ['src/checkout.ts', 'src/shared.ts']

let harness: Harness

beforeEach(async () => {
  harness = await resetHarness()
})

describe('processWebhook - sync happens-before detect', () => {
  it('detects overlaps from the index syncBranchFiles just wrote', async () => {
    const { repositoryId, pushedBranchId } = await seedRepository(harness)
    const otherBranchId = await seedBranchWithFiles(
      harness,
      repositoryId,
      'feature/pricing',
      OVERLAPPING_FILES
    )
    await seedWebhookDelivery(harness, 'delivery-order', pushPayload())

    // The pushed branch starts with nothing indexed. `detectOverlaps` returns
    // early for a branch with no tracked files, so if it ran before - or
    // concurrently with - the sync it would find nothing.
    const filesBefore = await harness.db.query.branchFiles.findMany({
      where: eq(harness.schema.branchFiles.branchId, pushedBranchId),
    })
    expect(filesBefore).toHaveLength(0)

    github().branchFiles[PUSHED_BRANCH] = [
      { filename: 'src/checkout.ts', status: 'modified' },
      { filename: 'src/shared.ts', status: 'added' },
    ]
    // Long enough that a detection merely racing the sync would lose. The old
    // system's answer to this was `delay: 5000`.
    github().getBranchFilesDelayMs = 250

    const run = await start(processWebhook, ['delivery-order'])
    await expect(run.returnValue).resolves.toEqual({ handled: true })
    await expect(run.status).resolves.toBe('completed')

    // The durable log is the runtime's own record of the ordering.
    const log = await stepLog(run.runId)
    const syncCompleted = firstIndexOf(log, 'step_completed', 'syncBranchFiles')
    const detectCreated = firstIndexOf(log, 'step_created', 'detectOverlaps')

    expect(syncCompleted).toBeGreaterThanOrEqual(0)
    expect(detectCreated).toBeGreaterThanOrEqual(0)
    expect(syncCompleted).toBeLessThan(detectCreated)

    // GitHub was consulted exactly once, for the branch that was pushed.
    const branchFileCalls = github().calls.filter(
      (call) => call.method === 'getBranchFiles'
    )
    expect(branchFileCalls).toHaveLength(1)
    expect(branchFileCalls[0]?.args).toEqual([
      INSTALLATION_ID,
      'acme',
      'widgets',
      PUSHED_BRANCH,
      DEFAULT_BRANCH,
    ])

    // The index the sync wrote.
    const filesAfter = await harness.db.query.branchFiles.findMany({
      where: eq(harness.schema.branchFiles.branchId, pushedBranchId),
    })
    expect(filesAfter.map((file) => file.filePath).sort()).toEqual(
      OVERLAPPING_FILES
    )

    // And the overlap that could only have come from reading it.
    const detected = await harness.db.query.overlaps.findMany({
      with: { files: true },
    })
    expect(detected).toHaveLength(1)
    expect(detected[0]).toMatchObject({
      repositoryId,
      sourceBranchId: pushedBranchId,
      targetBranchId: otherBranchId,
      status: 'active',
      fileCount: 2,
    })
    expect(detected[0]?.files.map((file) => file.filePath).sort()).toEqual(
      OVERLAPPING_FILES
    )

    const event = await webhookEventRow(harness, 'delivery-order')
    expect(event?.processedAt).toBeInstanceOf(Date)
    expect(event?.error).toBeNull()
  })

  it('records nothing for detection when the sync finds no files', async () => {
    // The negative control for the assertion above: with an empty index the
    // same run reaches `detectOverlaps` and finds nothing, which is what makes
    // the overlap in the previous test evidence of the sync's output rather
    // than of the seed data.
    const { repositoryId, pushedBranchId } = await seedRepository(harness)
    await seedBranchWithFiles(
      harness,
      repositoryId,
      'feature/pricing',
      OVERLAPPING_FILES
    )
    await seedWebhookDelivery(harness, 'delivery-empty', pushPayload())

    github().branchFiles[PUSHED_BRANCH] = []

    const run = await start(processWebhook, ['delivery-empty'])
    await expect(run.returnValue).resolves.toEqual({ handled: true })

    const log = await stepLog(run.runId)
    expect(countOf(log, 'step_completed', 'syncBranchFiles')).toBe(1)
    expect(countOf(log, 'step_completed', 'detectOverlaps')).toBe(1)

    const filesAfter = await harness.db.query.branchFiles.findMany({
      where: eq(harness.schema.branchFiles.branchId, pushedBranchId),
    })
    expect(filesAfter).toHaveLength(0)
    await expect(harness.db.query.overlaps.findMany()).resolves.toHaveLength(0)
  })
})

describe('processWebhook - failure bookkeeping', () => {
  it('records the error on the delivery and still fails the run', async () => {
    await seedRepository(harness)
    // A payload GitHub would never send. `parsePayload` raises a FatalError,
    // so the run fails on its first step with no retries.
    await seedWebhookDelivery(harness, 'delivery-broken', {
      ...pushPayload(),
      installation: undefined,
    })

    const run = await start(processWebhook, ['delivery-broken'])

    await expect(run.returnValue).rejects.toThrow(/Malformed webhook payload/)
    await expect(run.status).resolves.toBe('failed')

    // The failure path ran `markEventProcessed(deliveryId, message)`: the
    // error is on the row, and `processedAt` is deliberately not set.
    const event = await webhookEventRow(harness, 'delivery-broken')
    expect(event?.error).toMatch(/Malformed webhook payload for delivery/)
    expect(event?.processedAt).toBeNull()

    const log = await stepLog(run.runId)
    expect(countOf(log, 'step_failed', 'loadEvent')).toBeGreaterThan(0)
    expect(countOf(log, 'step_completed', 'markEventProcessed')).toBe(1)
  })

  it('records a GitHub failure raised deep in the run', async () => {
    const { repositoryId, pushedBranchId } = await seedRepository(harness)
    await seedBranchWithFiles(
      harness,
      repositoryId,
      'feature/pricing',
      OVERLAPPING_FILES
    )
    await seedOpenPullRequest(harness, repositoryId, pushedBranchId, 1)
    await seedWebhookDelivery(harness, 'delivery-github-404', pushPayload())

    github().branchFiles[PUSHED_BRANCH] = OVERLAPPING_FILES.map((filename) => ({
      filename,
      status: 'modified',
    }))
    // A 4xx from GitHub is classified fatal by `classifyGitHubError`, so the
    // step fails outright rather than being retried.
    github().createCheckRunError = Object.assign(new Error('Not Found'), {
      status: 404,
    })

    const run = await start(processWebhook, ['delivery-github-404'])

    await expect(run.returnValue).rejects.toThrow(/Not Found/)
    await expect(run.status).resolves.toBe('failed')

    const event = await webhookEventRow(harness, 'delivery-github-404')
    expect(event?.error).toMatch(/Not Found/)
    expect(event?.processedAt).toBeNull()

    // The steps that ran before the failure are not rolled back - the overlap
    // detection they performed is still on the row.
    await expect(harness.db.query.overlaps.findMany()).resolves.toHaveLength(1)
  })
})

describe('processWebhook - check run fan-out', () => {
  it('posts one check run per pull request, not per overlap per pull request', async () => {
    const { repositoryId, pushedBranchId } = await seedRepository(harness)
    await seedBranchWithFiles(
      harness,
      repositoryId,
      'feature/pricing',
      OVERLAPPING_FILES
    )
    await seedBranchWithFiles(
      harness,
      repositoryId,
      'feature/tax',
      OVERLAPPING_FILES
    )
    const prOne = await seedOpenPullRequest(
      harness,
      repositoryId,
      pushedBranchId,
      101
    )
    const prTwo = await seedOpenPullRequest(
      harness,
      repositoryId,
      pushedBranchId,
      102
    )
    await seedWebhookDelivery(harness, 'delivery-fanout', pushPayload())

    github().branchFiles[PUSHED_BRANCH] = OVERLAPPING_FILES.map((filename) => ({
      filename,
      status: 'modified',
    }))

    const run = await start(processWebhook, ['delivery-fanout'])
    await expect(run.returnValue).resolves.toEqual({ handled: true })

    // Two overlaps (pricing, tax) x two open pull requests. Walking the
    // notifications naively would post four check runs.
    const overlaps = await harness.db.query.overlaps.findMany()
    expect(overlaps).toHaveLength(2)

    const log = await stepLog(run.runId)
    expect(countOf(log, 'step_created', 'postCheckRun')).toBe(2)
    expect(countOf(log, 'step_created', 'sendPush')).toBe(2)

    const createCalls = github().calls.filter(
      (call) => call.method === 'createCheckRun'
    )
    expect(createCalls).toHaveLength(2)
    // Both check runs went to the same repository at the pushed head sha.
    for (const call of createCalls) {
      expect(call.args[1]).toBe(REPO_FULL_NAME.split('/')[0])
      expect(call.args[3]).toBe(HEAD_SHA)
    }

    // One alert row per pull request, both naming the same overlap - the id
    // of the first notification that listed that pull request.
    const alerts = await harness.db.query.prAlerts.findMany()
    expect(alerts).toHaveLength(2)
    expect(alerts.map((alert) => alert.pullRequestId).sort()).toEqual(
      [prOne, prTwo].sort()
    )
    expect(new Set(alerts.map((alert) => alert.overlapId)).size).toBe(1)

    const stillActive = await harness.db.query.overlaps.findMany({
      where: and(
        eq(harness.schema.overlaps.repositoryId, repositoryId),
        eq(harness.schema.overlaps.status, 'active')
      ),
    })
    expect(stillActive).toHaveLength(2)
  })
})
