import type { Job } from 'bullmq'
import { db, branches, branchFiles, repositories, repositorySettings } from '@overlap/db'
import { eq, and, inArray } from 'drizzle-orm'
import type { BranchSyncJob } from '@overlap/shared'
import { DEFAULT_SETTINGS } from '@overlap/shared'
import { getGitHubClient, type CommitFile } from '@overlap/github'
import { minimatch } from 'minimatch'

export async function branchSyncProcessor(job: Job<BranchSyncJob>) {
  const { repositoryId, branchName, sha, installationId } = job.data

  console.log(`Syncing branch: ${branchName} (${sha.slice(0, 7)})`)

  // Get repository info
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repositoryId),
    with: { settings: true },
  })

  if (!repo) {
    throw new Error(`Repository not found: ${repositoryId}`)
  }

  // Get branch record
  const branch = await db.query.branches.findFirst({
    where: and(
      eq(branches.repositoryId, repositoryId),
      eq(branches.name, branchName)
    ),
  })

  if (!branch) {
    throw new Error(`Branch not found: ${branchName}`)
  }

  // Get ignored paths
  const ignoredPaths = repo.settings?.ignoredPaths ?? DEFAULT_SETTINGS.IGNORED_PATHS

  // Get GitHub client and fetch changed files
  const github = getGitHubClient()
  const [owner, repoName] = repo.fullName.split('/')

  let changedFiles: CommitFile[]

  try {
    // Compare branch to default branch to get all changed files
    changedFiles = await github.getBranchFiles(
      installationId,
      owner,
      repoName,
      branchName,
      repo.defaultBranch
    )
  } catch (error) {
    console.error(`Failed to fetch branch files: ${error}`)
    changedFiles = []
  }

  // Filter out ignored paths
  const filteredFiles = changedFiles.filter((file) => {
    return !ignoredPaths.some((pattern) => minimatch(file.filename, pattern))
  })

  console.log(`Found ${filteredFiles.length} changed files (${changedFiles.length} before filtering)`)

  // Update branch files
  // First, delete existing files for this branch
  await db.delete(branchFiles).where(eq(branchFiles.branchId, branch.id))

  // Insert new files
  if (filteredFiles.length > 0) {
    await db.insert(branchFiles).values(
      filteredFiles.map((file) => ({
        branchId: branch.id,
        filePath: file.filename,
        changeType: mapChangeType(file.status),
      }))
    )
  }

  // Update branch sha and last seen
  await db
    .update(branches)
    .set({
      sha,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(branches.id, branch.id))

  // Update repository last synced
  await db
    .update(repositories)
    .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(repositories.id, repositoryId))

  console.log(`Branch sync complete: ${branchName}`)

  return { filesIndexed: filteredFiles.length }
}

function mapChangeType(status: string): 'added' | 'modified' | 'deleted' | 'renamed' {
  switch (status) {
    case 'added':
      return 'added'
    case 'removed':
      return 'deleted'
    case 'renamed':
      return 'renamed'
    default:
      return 'modified'
  }
}
