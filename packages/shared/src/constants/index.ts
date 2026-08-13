// ============================================================================
// Default Settings
// ============================================================================

export const DEFAULT_SETTINGS = {
  PRUNING_DAYS: 14,
  IGNORED_PATHS: [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '*.min.js',
    '*.min.css',
    'dist/**',
    'build/**',
    'node_modules/**',
  ],
  NOTIFY_ON_NEW_OVERLAP: true,
  NOTIFY_ON_SEVERITY_INCREASE: true,
} as const

// ============================================================================
// Severity Thresholds
// ============================================================================

export const SEVERITY_THRESHOLDS = {
  LOW: 1, // 1-2 files
  MEDIUM: 3, // 3-5 files
  HIGH: 6, // 6-10 files
  CRITICAL: 11, // 11+ files
} as const

export function calculateSeverity(
  fileCount: number
): 'low' | 'medium' | 'high' | 'critical' {
  if (fileCount >= SEVERITY_THRESHOLDS.CRITICAL) return 'critical'
  if (fileCount >= SEVERITY_THRESHOLDS.HIGH) return 'high'
  if (fileCount >= SEVERITY_THRESHOLDS.MEDIUM) return 'medium'
  return 'low'
}

// ============================================================================
// GitHub Events
// ============================================================================

export const GITHUB_EVENTS = {
  PUSH: 'push',
  PULL_REQUEST: 'pull_request',
  INSTALLATION: 'installation',
  INSTALLATION_REPOSITORIES: 'installation_repositories',
} as const

export const PR_ACTIONS = {
  OPENED: 'opened',
  SYNCHRONIZE: 'synchronize',
  REOPENED: 'reopened',
  CLOSED: 'closed',
} as const

// ============================================================================
// Error Codes
// ============================================================================

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
