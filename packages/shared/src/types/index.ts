// ============================================================================
// Core Entity Types
// ============================================================================

export interface User {
  id: string
  githubId: number
  username: string
  email: string | null
  avatarUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Organization {
  id: string
  githubId: number
  name: string
  avatarUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export interface GitHubAppInstallation {
  id: string
  installationId: number
  organizationId: string | null
  userId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Repository {
  id: string
  githubId: number
  installationId: string
  name: string
  fullName: string
  defaultBranch: string
  isPrivate: boolean
  isActive: boolean
  lastSyncedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface RepositorySettings {
  id: string
  repositoryId: string
  pruningDays: number
  ignoredPaths: string[]
  notifyOnNewOverlap: boolean
  notifyOnSeverityIncrease: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Branch {
  id: string
  repositoryId: string
  name: string
  sha: string
  isDefault: boolean
  lastSeenAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface BranchFile {
  id: string
  branchId: string
  filePath: string
  changeType: FileChangeType
  createdAt: Date
}

export interface Overlap {
  id: string
  repositoryId: string
  sourceBranchId: string
  targetBranchId: string
  fileCount: number
  severity: OverlapSeverity
  status: OverlapStatus
  detectedAt: Date
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface OverlapFile {
  id: string
  overlapId: string
  filePath: string
  sourceChangeType: FileChangeType
  targetChangeType: FileChangeType
  createdAt: Date
}

export interface PullRequest {
  id: string
  repositoryId: string
  branchId: string
  githubPrNumber: number
  title: string
  state: PullRequestState
  createdAt: Date
  updatedAt: Date
}

export interface PrAlert {
  id: string
  pullRequestId: string
  overlapId: string
  alertType: AlertType
  commentId: number | null
  checkRunId: number | null
  createdAt: Date
}

export interface WebhookEvent {
  id: string
  eventType: string
  deliveryId: string
  repositoryId: string | null
  payload: Record<string, unknown>
  processedAt: Date | null
  error: string | null
  createdAt: Date
}

// ============================================================================
// Enums
// ============================================================================

export type FileChangeType = 'added' | 'modified' | 'deleted' | 'renamed'

export type OverlapSeverity = 'low' | 'medium' | 'high' | 'critical'

export type OverlapStatus = 'active' | 'resolved' | 'ignored'

export type PullRequestState = 'open' | 'closed' | 'merged'

export type AlertType = 'comment' | 'check_run' | 'both'

// ============================================================================
// API Types
// ============================================================================

export interface OverlapSummary {
  id: string
  sourceBranch: {
    id: string
    name: string
  }
  targetBranch: {
    id: string
    name: string
  }
  fileCount: number
  severity: OverlapSeverity
  status: OverlapStatus
  files: string[]
  detectedAt: Date
}

export interface BranchSummary {
  id: string
  name: string
  sha: string
  isDefault: boolean
  lastSeenAt: Date
  fileCount: number
  overlappingBranches: number
}

export interface RepositorySummary {
  id: string
  name: string
  fullName: string
  defaultBranch: string
  isPrivate: boolean
  activeBranches: number
  activeOverlaps: number
  lastSyncedAt: Date | null
}

// ============================================================================
// Queue Job Types
// ============================================================================

export interface WebhookEventJob {
  eventType: string
  deliveryId: string
  payload: Record<string, unknown>
}

export interface BranchSyncJob {
  repositoryId: string
  branchName: string
  sha: string
  installationId: number
}

export interface OverlapDetectionJob {
  repositoryId: string
  branchId: string
  triggeredBy: 'push' | 'sync' | 'manual'
}

export interface GitHubFeedbackJob {
  repositoryId: string
  pullRequestId: string
  overlapId: string
  alertType: AlertType
}

export interface MaintenanceJob {
  type: 'prune_branches' | 'cleanup_events' | 'sync_repository'
  repositoryId?: string
}

export interface PushNotificationJob {
  repositoryId: string
  overlapId: string
  targetBranchId: string
}
