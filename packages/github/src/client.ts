import { Octokit } from '@octokit/rest'
import { createAppAuth } from '@octokit/auth-app'

// Rate limit handling
export class RateLimitError extends Error {
  retryAfter: number

  constructor(message: string, retryAfter: number) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: unknown) {
      lastError = error as Error

      // Check for rate limit
      if (isRateLimitError(error)) {
        const retryAfter = getRateLimitRetryAfter(error)
        if (retryAfter > 0 && retryAfter < 300) {
          // Max wait 5 minutes
          console.log(`Rate limited. Waiting ${retryAfter}s before retry...`)
          await sleep(retryAfter * 1000)
          continue
        }
        throw new RateLimitError('GitHub API rate limit exceeded', retryAfter)
      }

      // Check for secondary rate limit (abuse detection)
      if (isSecondaryRateLimit(error)) {
        const delay = baseDelay * Math.pow(2, attempt)
        console.log(`Secondary rate limit. Waiting ${delay}ms before retry...`)
        await sleep(delay)
        continue
      }

      // Check for transient errors (5xx)
      if (isTransientError(error) && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt)
        console.log(`Transient error. Waiting ${delay}ms before retry...`)
        await sleep(delay)
        continue
      }

      throw error
    }
  }

  throw lastError
}

function isRateLimitError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const err = error as { status?: number; response?: { headers?: Record<string, string> } }
  return err.status === 403 && err.response?.headers?.['x-ratelimit-remaining'] === '0'
}

function isSecondaryRateLimit(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const err = error as { status?: number; message?: string }
  return err.status === 403 && (err.message?.includes('secondary rate limit') ?? false)
}

function isTransientError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const err = error as { status?: number }
  return typeof err.status === 'number' && err.status >= 500
}

function getRateLimitRetryAfter(error: unknown): number {
  if (typeof error !== 'object' || error === null) return 60
  const err = error as { response?: { headers?: Record<string, string> } }
  const retryAfter = err.response?.headers?.['retry-after']
  const resetTime = err.response?.headers?.['x-ratelimit-reset']

  if (retryAfter) {
    return parseInt(retryAfter, 10)
  }

  if (resetTime) {
    const resetTimestamp = parseInt(resetTime, 10) * 1000
    return Math.max(0, Math.ceil((resetTimestamp - Date.now()) / 1000))
  }

  return 60 // Default to 60 seconds
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface GitHubConfig {
  appId: string
  privateKey: string
  clientId?: string
  clientSecret?: string
}

export interface CommitFile {
  filename: string
  status: 'added' | 'modified' | 'removed' | 'renamed'
  previousFilename?: string
}

export interface FileDiff {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch: string | null
  previousFilename?: string
}

export interface BranchInfo {
  name: string
  sha: string
  protected: boolean
}

export interface PullRequestInfo {
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  head: {
    ref: string
    sha: string
  }
  base: {
    ref: string
  }
}

export class GitHubClient {
  private config: GitHubConfig
  private installationClients: Map<number, Octokit> = new Map()

  constructor(config: GitHubConfig) {
    this.config = config
  }

  /**
   * Get an authenticated Octokit instance for a specific installation
   */
  async getInstallationClient(installationId: number): Promise<Octokit> {
    const cached = this.installationClients.get(installationId)
    if (cached) {
      return cached
    }

    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: this.config.appId,
        privateKey: this.config.privateKey,
        installationId,
      },
    })

    this.installationClients.set(installationId, octokit)
    return octokit
  }

  /**
   * Get files changed in a specific commit
   */
  async getCommitFiles(
    installationId: number,
    owner: string,
    repo: string,
    sha: string
  ): Promise<CommitFile[]> {
    const octokit = await this.getInstallationClient(installationId)

    return withRetry(async () => {
      const { data } = await octokit.repos.getCommit({
        owner,
        repo,
        ref: sha,
      })

      return (data.files || []).map((file) => ({
        filename: file.filename,
        status: file.status as CommitFile['status'],
        previousFilename: file.previous_filename,
      }))
    })
  }

  /**
   * Get files changed between two commits (for force pushes or branch comparison)
   */
  async getCompareFiles(
    installationId: number,
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<CommitFile[]> {
    const octokit = await this.getInstallationClient(installationId)

    return withRetry(async () => {
      const { data } = await octokit.repos.compareCommits({
        owner,
        repo,
        base,
        head,
      })

      return (data.files || []).map((file) => ({
        filename: file.filename,
        status: file.status as CommitFile['status'],
        previousFilename: file.previous_filename,
      }))
    })
  }

  /**
   * Get all file diffs between two refs (returns patches for every changed file)
   */
  async getCompareDiffs(
    installationId: number,
    owner: string,
    repo: string,
    base: string,
    head: string
  ): Promise<FileDiff[]> {
    const octokit = await this.getInstallationClient(installationId)

    return withRetry(async () => {
      const { data } = await octokit.repos.compareCommits({
        owner,
        repo,
        base,
        head,
      })

      return (data.files || []).map((file) => ({
        filename: file.filename,
        status: file.status ?? 'modified',
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch ?? null,
        previousFilename: file.previous_filename,
      }))
    })
  }

  /**
   * Get all branches for a repository
   */
  async getBranches(
    installationId: number,
    owner: string,
    repo: string
  ): Promise<BranchInfo[]> {
    const octokit = await this.getInstallationClient(installationId)
    const branches: BranchInfo[] = []

    for await (const response of octokit.paginate.iterator(
      octokit.repos.listBranches,
      { owner, repo, per_page: 100 }
    )) {
      for (const branch of response.data) {
        branches.push({
          name: branch.name,
          sha: branch.commit.sha,
          protected: branch.protected,
        })
      }
    }

    return branches
  }

  /**
   * Get repository default branch
   */
  async getDefaultBranch(
    installationId: number,
    owner: string,
    repo: string
  ): Promise<string> {
    const octokit = await this.getInstallationClient(installationId)

    const { data } = await octokit.repos.get({
      owner,
      repo,
    })

    return data.default_branch
  }

  /**
   * Create or update a PR comment
   */
  async createOrUpdatePRComment(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    existingCommentId?: number
  ): Promise<number> {
    const octokit = await this.getInstallationClient(installationId)

    return withRetry(async () => {
      if (existingCommentId) {
        await octokit.issues.updateComment({
          owner,
          repo,
          comment_id: existingCommentId,
          body,
        })
        return existingCommentId
      }

      const { data } = await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      })

      return data.id
    })
  }

  /**
   * Create a check run
   */
  async createCheckRun(
    installationId: number,
    owner: string,
    repo: string,
    headSha: string,
    name: string,
    conclusion: 'success' | 'failure' | 'neutral',
    title: string,
    summary: string
  ): Promise<number> {
    const octokit = await this.getInstallationClient(installationId)

    return withRetry(async () => {
      const { data } = await octokit.checks.create({
        owner,
        repo,
        name,
        head_sha: headSha,
        status: 'completed',
        conclusion,
        output: {
          title,
          summary,
        },
      })

      return data.id
    })
  }

  /**
   * Get a pull request by number
   */
  async getPullRequest(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PullRequestInfo> {
    const octokit = await this.getInstallationClient(installationId)

    const { data } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    })

    return {
      number: data.number,
      title: data.title,
      state: data.state as 'open' | 'closed',
      merged: data.merged,
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
      },
      base: {
        ref: data.base.ref,
      },
    }
  }

  /**
   * List repositories accessible to an installation
   */
  async listInstallationRepositories(
    installationId: number
  ): Promise<Array<{ id: number; name: string; fullName: string; isPrivate: boolean; defaultBranch: string }>> {
    const octokit = await this.getInstallationClient(installationId)
    const repos: Array<{ id: number; name: string; fullName: string; isPrivate: boolean; defaultBranch: string }> = []

    for await (const response of octokit.paginate.iterator(
      octokit.apps.listReposAccessibleToInstallation,
      { per_page: 100 }
    )) {
      for (const repo of response.data) {
        repos.push({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          isPrivate: repo.private,
          defaultBranch: repo.default_branch,
        })
      }
    }

    return repos
  }

  /**
   * Get all files changed in a branch compared to default branch
   * This is used for initial sync or force push re-indexing
   */
  async getBranchFiles(
    installationId: number,
    owner: string,
    repo: string,
    branchName: string,
    defaultBranch: string
  ): Promise<CommitFile[]> {
    try {
      return await this.getCompareFiles(
        installationId,
        owner,
        repo,
        defaultBranch,
        branchName
      )
    } catch (error) {
      // If comparison fails (e.g., no common ancestor), return empty
      console.error(`Failed to compare branches: ${error}`)
      return []
    }
  }
}

// Singleton instance
let githubClient: GitHubClient | null = null

export function getGitHubClient(): GitHubClient {
  if (!githubClient) {
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY

    if (!appId || !privateKey) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set')
    }

    githubClient = new GitHubClient({
      appId,
      privateKey: privateKey.replace(/\\n/g, '\n'),
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  }

  return githubClient
}
