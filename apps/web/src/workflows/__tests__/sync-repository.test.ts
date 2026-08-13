import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * `syncRepository`'s bulk branch upsert used to be one `INSERT ... ON
 * CONFLICT` statement over every remote branch. The Postgres wire protocol
 * encodes the Bind message's parameter count as an int16, so a single
 * statement breaks once it needs more than 65535 bound parameters - each row
 * binds 5 columns plus `updatedAt` again in the conflict `set`, i.e.
 * `5n + 1` parameters for n rows, a hard ceiling at n = 13106. Past that, the
 * statement fails deterministically on every attempt and the repository
 * never finishes syncing (see the doc comment on `syncRepository` in
 * `../steps.ts`).
 *
 * The fix chunks the insert at `BRANCH_INSERT_CHUNK_SIZE` (5000) rows. These
 * tests pin that a remote branch list larger than one chunk results in more
 * than one insert call, and that the chunked writes cover exactly the same
 * rows a single unchunked call would have. Row counts here stay well under
 * 13,000 - large enough to force more than one chunk, small enough to run
 * instantly, since the database itself is mocked and never sees real SQL.
 */

const { dbMock, insertSpy, updateSpy } = vi.hoisted(() => {
  const insertSpy = vi.fn()
  const updateSpy = vi.fn()

  const dbMock = {
    query: {
      repositories: { findFirst: vi.fn() },
      branches: { findMany: vi.fn() },
    },
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((rows: unknown) => ({
        onConflictDoUpdate: vi.fn(async (opts: unknown) => {
          insertSpy(table, rows, opts)
        }),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(async (condition: unknown) => {
          updateSpy(table, values, condition)
        }),
      })),
    })),
  }

  return { dbMock, insertSpy, updateSpy }
})

vi.mock('@overlap/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@overlap/db')>()
  return { ...actual, db: dbMock }
})

const { githubMock } = vi.hoisted(() => {
  const githubMock = {
    getBranches: vi.fn(),
  }
  return { githubMock }
})

vi.mock('@overlap/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@overlap/github')>()
  return { ...actual, getGitHubClient: () => githubMock }
})

const { branches, repositories } = await import('@overlap/db')
const { syncRepository, BRANCH_INSERT_CHUNK_SIZE } = await import('../steps')

const REPOSITORY_ID = 'repo-uuid'
const INSTALLATION_ID = 42

const repo = {
  id: REPOSITORY_ID,
  fullName: 'acme/widgets',
  defaultBranch: 'main',
  installation: { installationId: INSTALLATION_ID },
}

/** Builds `count` distinct fake remote branches, cheap to generate. */
function fakeRemoteBranches(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `branch-${i}`,
    sha: `sha-${i}`,
  }))
}

describe('syncRepository (bulk insert chunking)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.query.repositories.findFirst.mockResolvedValue(repo)
    dbMock.query.branches.findMany.mockResolvedValue([])
  })

  it('issues a single insert call when the remote branch list fits in one chunk', async () => {
    const remoteBranches = fakeRemoteBranches(BRANCH_INSERT_CHUNK_SIZE)
    githubMock.getBranches.mockResolvedValue(remoteBranches)

    await syncRepository(REPOSITORY_ID)

    const branchInsertCalls = insertSpy.mock.calls.filter(([table]) => table === branches)
    expect(branchInsertCalls).toHaveLength(1)
    expect((branchInsertCalls[0]?.[1] as unknown[]).length).toBe(BRANCH_INSERT_CHUNK_SIZE)
  })

  it('splits a remote branch list larger than one chunk across more than one insert call', async () => {
    const totalBranches = BRANCH_INSERT_CHUNK_SIZE + 1001
    const remoteBranches = fakeRemoteBranches(totalBranches)
    githubMock.getBranches.mockResolvedValue(remoteBranches)

    const result = await syncRepository(REPOSITORY_ID)

    const branchInsertCalls = insertSpy.mock.calls.filter(([table]) => table === branches)
    expect(branchInsertCalls.length).toBeGreaterThan(1)
    expect(branchInsertCalls).toHaveLength(2)
    expect((branchInsertCalls[0]?.[1] as unknown[]).length).toBe(BRANCH_INSERT_CHUNK_SIZE)
    expect((branchInsertCalls[1]?.[1] as unknown[]).length).toBe(1001)

    // The rows written across chunks must cover exactly the same set a
    // single unchunked call would have written - chunking must not drop,
    // duplicate, or reorder-corrupt any row.
    const writtenNames = branchInsertCalls
      .flatMap(([, rows]) => rows as Array<{ name: string }>)
      .map((row) => row.name)
      .sort()
    const expectedNames = remoteBranches.map((b) => b.name).sort()
    expect(writtenNames).toEqual(expectedNames)

    // added/updated counts are computed from the full remote list regardless
    // of chunking, so they must reflect every branch, not just one chunk's.
    expect(result.added).toBe(totalBranches)

    // The repository's lastSyncedAt update still runs exactly once after
    // chunking, not once per chunk.
    const repoUpdateCalls = updateSpy.mock.calls.filter(([table]) => table === repositories)
    expect(repoUpdateCalls).toHaveLength(1)
  })

  it('does not insert at all when there are no remote branches', async () => {
    githubMock.getBranches.mockResolvedValue([])

    await syncRepository(REPOSITORY_ID)

    const branchInsertCalls = insertSpy.mock.calls.filter(([table]) => table === branches)
    expect(branchInsertCalls).toHaveLength(0)
  })
})
