import { Webhooks } from '@octokit/webhooks'
import { createHmac, timingSafeEqual } from 'crypto'

export interface WebhookVerificationResult {
  valid: boolean
  error?: string
}

/**
 * Verify GitHub webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): WebhookVerificationResult {
  if (!signature) {
    return { valid: false, error: 'Missing signature header' }
  }

  if (!signature.startsWith('sha256=')) {
    return { valid: false, error: 'Invalid signature format' }
  }

  const expectedSignature = `sha256=${createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`

  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (signatureBuffer.length !== expectedBuffer.length) {
    return { valid: false, error: 'Signature length mismatch' }
  }

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return { valid: false, error: 'Invalid signature' }
  }

  return { valid: true }
}

/**
 * Create webhooks instance for event handling
 */
export function createWebhooks(secret: string): Webhooks {
  return new Webhooks({
    secret,
  })
}

/**
 * Extract branch name from ref (refs/heads/main -> main)
 */
export function extractBranchFromRef(ref: string): string | null {
  const prefix = 'refs/heads/'
  if (ref.startsWith(prefix)) {
    return ref.slice(prefix.length)
  }
  return null
}

/**
 * Check if this is a branch deletion event
 */
export function isBranchDeletion(after: string): boolean {
  return after === '0000000000000000000000000000000000000000'
}

/**
 * Check if this is a new branch creation
 */
export function isBranchCreation(before: string): boolean {
  return before === '0000000000000000000000000000000000000000'
}

/**
 * Format overlap message for PR comments
 */
export function formatOverlapComment(
  overlaps: Array<{
    branchName: string
    files: string[]
    severity: 'low' | 'medium' | 'high' | 'critical'
  }>
): string {
  if (overlaps.length === 0) {
    return ''
  }

  const severityEmoji: Record<string, string> = {
    low: '🟡',
    medium: '🟠',
    high: '🔴',
    critical: '🚨',
  }

  let comment = `## ⚠️ Overlap Alert\n\n`
  comment += `This branch has overlapping file changes with ${overlaps.length} other branch${overlaps.length > 1 ? 'es' : ''}.\n\n`

  for (const overlap of overlaps) {
    const emoji = severityEmoji[overlap.severity]
    comment += `### ${emoji} \`${overlap.branchName}\` (${overlap.severity})\n\n`
    comment += `**${overlap.files.length} overlapping file${overlap.files.length > 1 ? 's' : ''}:**\n\n`

    const filesToShow = overlap.files.slice(0, 10)
    for (const file of filesToShow) {
      comment += `- \`${file}\`\n`
    }

    if (overlap.files.length > 10) {
      comment += `- ... and ${overlap.files.length - 10} more\n`
    }

    comment += '\n'
  }

  comment += `---\n`
  comment += `*Overlap detected by [Overlap](https://overlap.dev) — coordinate early to avoid merge conflicts.*`

  return comment
}

/**
 * Format check run summary
 */
export function formatCheckRunSummary(
  overlaps: Array<{
    branchName: string
    fileCount: number
    severity: 'low' | 'medium' | 'high' | 'critical'
  }>
): { conclusion: 'success' | 'failure' | 'neutral'; title: string; summary: string } {
  if (overlaps.length === 0) {
    return {
      conclusion: 'success',
      title: 'No overlapping changes detected',
      summary: 'This branch has no file overlap with other active branches.',
    }
  }

  const hasHighSeverity = overlaps.some((o) => o.severity === 'high' || o.severity === 'critical')
  const conclusion = hasHighSeverity ? 'failure' : 'neutral'

  const totalFiles = overlaps.reduce((sum, o) => sum + o.fileCount, 0)
  const title = `${overlaps.length} branch${overlaps.length > 1 ? 'es' : ''} with overlapping changes`

  let summary = `Found overlapping file changes with ${overlaps.length} other branch${overlaps.length > 1 ? 'es' : ''} (${totalFiles} total files).\n\n`

  for (const overlap of overlaps) {
    summary += `- **${overlap.branchName}**: ${overlap.fileCount} file${overlap.fileCount > 1 ? 's' : ''} (${overlap.severity})\n`
  }

  if (hasHighSeverity) {
    summary += `\n⚠️ **High severity overlap detected.** Consider coordinating with team members to avoid merge conflicts.`
  }

  return { conclusion, title, summary }
}
