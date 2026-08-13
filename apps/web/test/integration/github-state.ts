/**
 * State shared between the fake `@overlap/github` module and the tests.
 *
 * The fake lives in a bundle that Node loads natively (see `build-shims.ts`),
 * while the test file is loaded by Vitest's module runner. Those are two
 * different module graphs, so the state cannot be shared by importing it.
 * It is parked on `globalThis` instead, which both graphs agree on because
 * they run in the same worker process.
 */

/** The subset of `CommitFile` the steps actually read. */
export type FakeCommitFile = {
  filename: string
  status: string
}

export type FakeGitHubCall = {
  method: string
  args: unknown[]
}

export type GitHubFakeState = {
  /** Every call the steps made, in order. */
  calls: FakeGitHubCall[]
  /** What `getBranchFiles` returns, keyed by branch name. */
  branchFiles: Record<string, FakeCommitFile[]>
  /**
   * How long `getBranchFiles` takes. A non-zero value is what makes the
   * sync-then-detect ordering test meaningful: if detection were merely
   * racing sync rather than sequenced after it, this delay decides the race.
   */
  getBranchFilesDelayMs: number
  /** When set, `createCheckRun` throws this instead of returning an id. */
  createCheckRunError: unknown
  /** Id handed out by the next successful `createCheckRun`. */
  nextCheckRunId: number
}

const KEY = '__overlapGitHubFakeState__'

export function createGitHubFakeState(): GitHubFakeState {
  return {
    calls: [],
    branchFiles: {},
    getBranchFilesDelayMs: 0,
    createCheckRunError: null,
    nextCheckRunId: 5000,
  }
}

export function getGitHubFakeState(): GitHubFakeState {
  const scope = globalThis as unknown as Record<string, GitHubFakeState>
  scope[KEY] ??= createGitHubFakeState()
  return scope[KEY]
}

export function resetGitHubFakeState(): void {
  const scope = globalThis as unknown as Record<string, GitHubFakeState>
  scope[KEY] = createGitHubFakeState()
}
