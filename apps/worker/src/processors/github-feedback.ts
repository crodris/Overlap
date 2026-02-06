import type { Job } from 'bullmq'
import { db, overlaps, overlapFiles, branches, pullRequests, prAlerts, repositories, githubAppInstallations } from '@overlap/db'
import { eq, and, inArray } from 'drizzle-orm'
import type { GitHubFeedbackJob } from '@overlap/shared'
import { getGitHubClient, formatCheckRunSummary } from '@overlap/github'

export async function githubFeedbackProcessor(job: Job<GitHubFeedbackJob>) {
  const { repositoryId, pullRequestId, overlapId, alertType } = job.data

  console.log(`Sending GitHub feedback for PR: ${pullRequestId}, overlap: ${overlapId}`)

  // Get the pull request
  const pr = await db.query.pullRequests.findFirst({
    where: eq(pullRequests.id, pullRequestId),
    with: {
      branch: true,
      repository: {
        with: {
          installation: true,
        },
      },
    },
  })

  if (!pr) {
    throw new Error(`Pull request not found: ${pullRequestId}`)
  }

  // Get the overlap with all files
  const overlap = await db.query.overlaps.findFirst({
    where: eq(overlaps.id, overlapId),
    with: {
      files: true,
      sourceBranch: true,
      targetBranch: true,
    },
  })

  if (!overlap) {
    throw new Error(`Overlap not found: ${overlapId}`)
  }

  // Get all active overlaps for this branch (not just the one that triggered)
  const allOverlaps = await db.query.overlaps.findMany({
    where: and(
      eq(overlaps.repositoryId, repositoryId),
      eq(overlaps.status, 'active')
    ),
    with: {
      files: true,
      sourceBranch: true,
      targetBranch: true,
    },
  })

  // Filter to overlaps involving this branch
  const branchOverlaps = allOverlaps.filter(
    (o) => o.sourceBranchId === pr.branch.id || o.targetBranchId === pr.branch.id
  )

  if (branchOverlaps.length === 0) {
    console.log('No active overlaps for this branch')
    return { checkRun: false }
  }

  // Check for existing alert (deduplication)
  const existingAlert = await db.query.prAlerts.findFirst({
    where: and(
      eq(prAlerts.pullRequestId, pullRequestId),
      eq(prAlerts.overlapId, overlapId)
    ),
  })

  const github = getGitHubClient()
  const [owner, repoName] = pr.repository.fullName.split('/')
  const installationId = pr.repository.installation.installationId

  let checkRunId: number | null = existingAlert?.checkRunId ?? null

  // Format overlap data for display
  const overlapData = branchOverlaps.map((o) => {
    const otherBranch =
      o.sourceBranchId === pr.branch.id ? o.targetBranch : o.sourceBranch

    return {
      branchName: otherBranch.name,
      files: o.files.map((f) => f.filePath),
      fileCount: o.fileCount,
      severity: o.severity as 'low' | 'medium' | 'high' | 'critical',
    }
  })

  // Create check run (no PR comments — GitHub already shows conflicts)
  const { conclusion, title, summary } = formatCheckRunSummary(overlapData)

  try {
    checkRunId = await github.createCheckRun(
      installationId,
      owner,
      repoName,
      pr.branch.sha,
      'Overlap Detection',
      conclusion,
      title,
      summary
    )
    console.log(`Check run created: ${checkRunId}`)
  } catch (error) {
    console.error('Failed to create check run:', error)
  }

  // Record the alert
  if (existingAlert) {
    await db
      .update(prAlerts)
      .set({ checkRunId })
      .where(eq(prAlerts.id, existingAlert.id))
  } else {
    await db.insert(prAlerts).values({
      pullRequestId,
      overlapId,
      alertType: 'check_run',
      checkRunId,
    })
  }

  return { checkRun: checkRunId !== null }
}
