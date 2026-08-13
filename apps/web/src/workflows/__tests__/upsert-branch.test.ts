import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * `upsertBranch` retires a branch when the push that triggered it deleted
 * the branch on GitHub: it deletes the branch's `branch_files` rows, resolves
 * any `overlaps` row naming the branch on either side, then deletes the
 * `branches` row itself, and returns null (there is nothing left to sync).
 *
 * This mirrors the cleanup the old Fastify route
 * (apps/api/src/routes/webhooks.ts) ran inline in the request handler. That
 * code is gone; this step is now the only place a deletion is acted on, so
 * these tests exist to pin that the cleanup actually runs rather than being
 * silently skipped (see task-11-report.md, Finding 1).
 */

const { dbMock, deleteSpy, updateOverlapsSpy } = vi.hoisted(() => {
  const deleteSpy = vi.fn()
  const updateOverlapsSpy = vi.fn()

  const dbMock = {
    query: {
      webhookEvents: { findFirst: vi.fn() },
      repositories: { findFirst: vi.fn() },
      branches: { findFirst: vi.fn() },
    },
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async (condition: unknown) => {
        deleteSpy(table, condition)
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(async (condition: unknown) => {
          updateOverlapsSpy(values, condition)
        }),
      })),
    })),
  }

  return { dbMock, deleteSpy, updateOverlapsSpy }
})

vi.mock('@overlap/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@overlap/db')>()
  return { ...actual, db: dbMock }
})

const { branches, branchFiles } = await import('@overlap/db')
const { upsertBranch } = await import('../steps')

const DELIVERY_ID = 'delivery-1'
const BRANCH_NAME = 'feature-x'
const REPO_ID = 'repo-uuid'
const BRANCH_ID = 'branch-uuid'

const deletionPushPayload = {
  ref: `refs/heads/${BRANCH_NAME}`,
  before: 'abc123',
  // The all-zero SHA is GitHub's signal for "this ref was deleted".
  after: '0000000000000000000000000000000000000000',
  repository: {
    id: 123,
    name: 'widgets',
    full_name: 'acme/widgets',
    default_branch: 'main',
    private: false,
  },
  sender: { id: 1, login: 'octocat' },
  installation: { id: 999 },
  commits: [],
}

describe('upsertBranch (branch deletion)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.query.webhookEvents.findFirst.mockResolvedValue({
      id: 'evt-1',
      eventType: 'push',
      payload: deletionPushPayload,
    })
    dbMock.query.repositories.findFirst.mockResolvedValue({
      id: REPO_ID,
      fullName: 'acme/widgets',
    })
    dbMock.query.branches.findFirst.mockResolvedValue({
      id: BRANCH_ID,
      repositoryId: REPO_ID,
      name: BRANCH_NAME,
    })
  })

  it('deletes the branch_files and branches rows and resolves affected overlaps', async () => {
    const result = await upsertBranch(DELIVERY_ID)

    expect(result).toBeNull()
    expect(deleteSpy).toHaveBeenCalledWith(branchFiles, expect.anything())
    expect(deleteSpy).toHaveBeenCalledWith(branches, expect.anything())
    expect(updateOverlapsSpy).toHaveBeenCalledTimes(1)
    expect(updateOverlapsSpy.mock.calls[0]?.[0]).toMatchObject({ status: 'resolved' })
  })

  it('resolves overlaps before deleting the branch row, so the branch still exists for the update', async () => {
    await upsertBranch(DELIVERY_ID)

    const branchDeleteCallIndex = deleteSpy.mock.calls.findIndex(
      ([table]) => table === branches
    )
    expect(branchDeleteCallIndex).toBeGreaterThanOrEqual(0)
    expect(updateOverlapsSpy).toHaveBeenCalledTimes(1)
    // update() was called (mocked above) strictly before the branches delete
    // in source order; vi.fn call ordering across two different mocks can't
    // be compared directly, so this is asserted structurally instead: both
    // happened, and only once each.
    expect(deleteSpy.mock.calls.filter(([table]) => table === branchFiles)).toHaveLength(1)
    expect(deleteSpy.mock.calls.filter(([table]) => table === branches)).toHaveLength(1)
  })

  it('does nothing when the deleted branch is not found locally', async () => {
    dbMock.query.branches.findFirst.mockResolvedValue(undefined)

    const result = await upsertBranch(DELIVERY_ID)

    expect(result).toBeNull()
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(updateOverlapsSpy).not.toHaveBeenCalled()
  })

  it('does nothing when the repository is not found locally', async () => {
    dbMock.query.repositories.findFirst.mockResolvedValue(undefined)

    const result = await upsertBranch(DELIVERY_ID)

    expect(result).toBeNull()
    expect(dbMock.query.branches.findFirst).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(updateOverlapsSpy).not.toHaveBeenCalled()
  })
})
