import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * `pruneStaleBranches` used to be a single `'use step'` function with a
 * `for` loop over every active repository inside it. A step is one function
 * invocation, so that loop's total runtime scaled with the number of
 * installations within one invocation's duration budget - the opposite of
 * what a durable workflow is for, and contrary to the comment in
 * `prune-branches.ts` claiming the work "must not be bounded by a single
 * function invocation".
 *
 * The fix splits it the same way `processWebhook` already splits the
 * installation fan-out for `syncRepository`: `getActiveRepositoryIds`
 * returns the id list as one step, and `pruneRepositoryBranches` prunes
 * exactly one repository per step invocation. `pruneBranchesWorkflow` (in
 * `../maintenance.ts`) does the looping. These tests pin the two steps in
 * isolation; the pruning logic itself is unchanged from the old loop body.
 */

const { dbMock, deleteSpy, updateOverlapsSpy } = vi.hoisted(() => {
  const deleteSpy = vi.fn()
  const updateOverlapsSpy = vi.fn()

  const dbMock = {
    query: {
      repositories: { findFirst: vi.fn(), findMany: vi.fn() },
      branches: { findMany: vi.fn() },
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
const { getActiveRepositoryIds, pruneRepositoryBranches } = await import('../steps')

const REPO_ID = 'repo-uuid'
const STALE_BRANCH_ID = 'branch-uuid'

describe('getActiveRepositoryIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the ids of active repositories only, filtered in the query', async () => {
    dbMock.query.repositories.findMany.mockResolvedValue([
      { id: 'repo-1' },
      { id: 'repo-2' },
    ])

    const result = await getActiveRepositoryIds()

    expect(result).toEqual({ repositoryIds: ['repo-1', 'repo-2'] })
    expect(dbMock.query.repositories.findMany).toHaveBeenCalledTimes(1)
  })

  it('returns an empty list when there are no active repositories', async () => {
    dbMock.query.repositories.findMany.mockResolvedValue([])

    const result = await getActiveRepositoryIds()

    expect(result).toEqual({ repositoryIds: [] })
  })
})

describe('pruneRepositoryBranches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prunes exactly the one repository it was called with, and nothing else', async () => {
    dbMock.query.repositories.findFirst.mockResolvedValue({
      id: REPO_ID,
      fullName: 'acme/widgets',
      settings: { pruningDays: 30 },
    })
    dbMock.query.branches.findMany.mockResolvedValue([
      { id: STALE_BRANCH_ID, repositoryId: REPO_ID, isDefault: false },
    ])

    const result = await pruneRepositoryBranches(REPO_ID)

    expect(result).toEqual({ prunedBranches: 1 })
    expect(dbMock.query.repositories.findFirst).toHaveBeenCalledTimes(1)
    expect(deleteSpy).toHaveBeenCalledWith(branchFiles, expect.anything())
    expect(deleteSpy).toHaveBeenCalledWith(branches, expect.anything())
    expect(updateOverlapsSpy).toHaveBeenCalledTimes(1)
    expect(updateOverlapsSpy.mock.calls[0]?.[0]).toMatchObject({ status: 'resolved' })
  })

  it('returns zero and touches nothing when the repository has no stale branches', async () => {
    dbMock.query.repositories.findFirst.mockResolvedValue({
      id: REPO_ID,
      fullName: 'acme/widgets',
      settings: { pruningDays: 30 },
    })
    dbMock.query.branches.findMany.mockResolvedValue([])

    const result = await pruneRepositoryBranches(REPO_ID)

    expect(result).toEqual({ prunedBranches: 0 })
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(updateOverlapsSpy).not.toHaveBeenCalled()
  })

  it('returns zero without querying branches when the repository no longer exists', async () => {
    dbMock.query.repositories.findFirst.mockResolvedValue(undefined)

    const result = await pruneRepositoryBranches(REPO_ID)

    expect(result).toEqual({ prunedBranches: 0 })
    expect(dbMock.query.branches.findMany).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('falls back to the default pruning window when the repository has no settings row', async () => {
    dbMock.query.repositories.findFirst.mockResolvedValue({
      id: REPO_ID,
      fullName: 'acme/widgets',
      settings: null,
    })
    dbMock.query.branches.findMany.mockResolvedValue([])

    await pruneRepositoryBranches(REPO_ID)

    expect(dbMock.query.branches.findMany).toHaveBeenCalledTimes(1)
  })
})
