import { describe, it, expect, beforeEach, vi } from 'vitest'
import { formatCheckRunSummary } from '@overlap/github'

/**
 * `postCheckRun` looks up the `pr_alerts` row before calling GitHub so a step
 * retry (GitHub call succeeded, step failed before returning) updates the
 * check run it already recorded instead of creating a duplicate. These tests
 * pin that branching: an existing `checkRunId` takes the update path, and its
 * absence takes the create path and records the id immediately.
 *
 * `db` and `getGitHubClient` are mocked because `postCheckRun` reads them
 * from module-level singletons; injecting a fake GitHub client is the only
 * way to observe which client method it called without a real installation
 * or a live database.
 */

const { dbMock, updateSpy, insertSpy } = vi.hoisted(() => {
  const updateSpy = vi.fn()
  const insertSpy = vi.fn()

  const dbMock = {
    query: {
      pullRequests: { findFirst: vi.fn() },
      overlaps: { findFirst: vi.fn(), findMany: vi.fn() },
      prAlerts: { findFirst: vi.fn() },
    },
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(async (condition: unknown) => {
          updateSpy(values, condition)
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: unknown) => {
        insertSpy(values)
      }),
    })),
  }

  return { dbMock, updateSpy, insertSpy }
})

vi.mock('@overlap/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@overlap/db')>()
  return { ...actual, db: dbMock }
})

const { githubMock } = vi.hoisted(() => {
  const githubMock = {
    createCheckRun: vi.fn(),
    updateCheckRun: vi.fn(),
  }
  return { githubMock }
})

vi.mock('@overlap/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@overlap/github')>()
  return { ...actual, getGitHubClient: () => githubMock }
})

const { postCheckRun } = await import('../steps')

const PULL_REQUEST_ID = 'pr-1'
const OVERLAP_ID = 'overlap-1'
const REPOSITORY_ID = 'repo-1'
const INSTALLATION_ID = 42

const pr = {
  id: PULL_REQUEST_ID,
  branch: { id: 'branch-1', sha: 'sha-123' },
  repository: {
    fullName: 'acme/widgets',
    installation: { installationId: INSTALLATION_ID },
  },
}

const branchOverlap = {
  id: OVERLAP_ID,
  sourceBranchId: 'branch-1',
  targetBranchId: 'branch-2',
  fileCount: 2,
  severity: 'high' as const,
  files: [{ filePath: 'a.ts' }, { filePath: 'b.ts' }],
  sourceBranch: { name: 'feature-a' },
  targetBranch: { name: 'feature-b' },
}

const expectedSummary = formatCheckRunSummary([
  { branchName: 'feature-b', fileCount: 2, severity: 'high' },
])

describe('postCheckRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.query.pullRequests.findFirst.mockResolvedValue(pr)
    dbMock.query.overlaps.findFirst.mockResolvedValue({ id: OVERLAP_ID })
    dbMock.query.overlaps.findMany.mockResolvedValue([branchOverlap])
  })

  it('updates the existing check run when pr_alerts already has a checkRunId', async () => {
    dbMock.query.prAlerts.findFirst.mockResolvedValue({
      id: 'alert-1',
      checkRunId: 555,
    })

    const result = await postCheckRun({
      repositoryId: REPOSITORY_ID,
      pullRequestId: PULL_REQUEST_ID,
      overlapId: OVERLAP_ID,
    })

    expect(githubMock.updateCheckRun).toHaveBeenCalledWith(
      INSTALLATION_ID,
      'acme',
      'widgets',
      555,
      expectedSummary.conclusion,
      expectedSummary.title,
      expectedSummary.summary
    )
    expect(githubMock.createCheckRun).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ checkRunId: 555 })
  })

  it('creates a check run and records it immediately when none has been recorded', async () => {
    dbMock.query.prAlerts.findFirst.mockResolvedValue(undefined)
    githubMock.createCheckRun.mockResolvedValue(999)

    const result = await postCheckRun({
      repositoryId: REPOSITORY_ID,
      pullRequestId: PULL_REQUEST_ID,
      overlapId: OVERLAP_ID,
    })

    expect(githubMock.createCheckRun).toHaveBeenCalledWith(
      INSTALLATION_ID,
      'acme',
      'widgets',
      'sha-123',
      'Overlap Detection',
      expectedSummary.conclusion,
      expectedSummary.title,
      expectedSummary.summary
    )
    expect(githubMock.updateCheckRun).not.toHaveBeenCalled()
    expect(insertSpy).toHaveBeenCalledWith({
      pullRequestId: PULL_REQUEST_ID,
      overlapId: OVERLAP_ID,
      alertType: 'check_run',
      checkRunId: 999,
    })
    expect(updateSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ checkRunId: 999 })
  })

  it('creates a check run and updates the stale pr_alerts row when one exists without a checkRunId', async () => {
    dbMock.query.prAlerts.findFirst.mockResolvedValue({
      id: 'alert-2',
      checkRunId: null,
    })
    githubMock.createCheckRun.mockResolvedValue(777)

    const result = await postCheckRun({
      repositoryId: REPOSITORY_ID,
      pullRequestId: PULL_REQUEST_ID,
      overlapId: OVERLAP_ID,
    })

    expect(githubMock.createCheckRun).toHaveBeenCalled()
    expect(githubMock.updateCheckRun).not.toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledWith(
      { checkRunId: 777 },
      expect.anything()
    )
    expect(insertSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ checkRunId: 777 })
  })
})
