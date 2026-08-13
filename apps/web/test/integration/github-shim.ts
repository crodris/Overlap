/**
 * Test-only stand-in for `@overlap/github`.
 *
 * `build-shims.ts` bundles this file to
 * `.workflow-vitest/node_modules/@overlap/github/index.mjs`, which Node
 * resolves ahead of the real workspace package when it loads the generated
 * step bundle. See `build-shims.ts` for why that is the seam.
 *
 * Only `getGitHubClient` is faked - it is the one export that opens a socket.
 * `extractBranchFromRef`, `isBranchDeletion` and `formatCheckRunSummary` are
 * pure and are re-exported from the real package, because the steps' handling
 * of refs, deletions and check-run bodies is part of what is under test.
 */

export {
  extractBranchFromRef,
  isBranchDeletion,
  isBranchCreation,
  formatOverlapComment,
  formatCheckRunSummary,
} from '@overlap/github/webhooks'

import { getGitHubFakeState, type FakeCommitFile } from './github-state.js'

const delay = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : undefined

class FakeGitHubClient {
  async getBranchFiles(
    installationId: number,
    owner: string,
    repo: string,
    branchName: string,
    defaultBranch: string
  ): Promise<FakeCommitFile[]> {
    const state = getGitHubFakeState()
    state.calls.push({
      method: 'getBranchFiles',
      args: [installationId, owner, repo, branchName, defaultBranch],
    })

    await delay(state.getBranchFilesDelayMs)

    return state.branchFiles[branchName] ?? []
  }

  async createCheckRun(
    installationId: number,
    owner: string,
    repo: string,
    headSha: string,
    name: string,
    conclusion: string,
    title: string,
    summary: string
  ): Promise<number> {
    const state = getGitHubFakeState()
    state.calls.push({
      method: 'createCheckRun',
      args: [
        installationId,
        owner,
        repo,
        headSha,
        name,
        conclusion,
        title,
        summary,
      ],
    })

    if (state.createCheckRunError) {
      throw state.createCheckRunError
    }

    return state.nextCheckRunId++
  }

  async updateCheckRun(
    installationId: number,
    owner: string,
    repo: string,
    checkRunId: number,
    conclusion: string,
    title: string,
    summary: string
  ): Promise<void> {
    const state = getGitHubFakeState()
    state.calls.push({
      method: 'updateCheckRun',
      args: [
        installationId,
        owner,
        repo,
        checkRunId,
        conclusion,
        title,
        summary,
      ],
    })
  }
}

let client: FakeGitHubClient | null = null

export function getGitHubClient(): FakeGitHubClient {
  client ??= new FakeGitHubClient()
  return client
}
