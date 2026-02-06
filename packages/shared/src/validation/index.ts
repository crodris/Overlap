import { z } from 'zod'

// ============================================================================
// Common Schemas
// ============================================================================

export const idSchema = z.string().uuid()

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ============================================================================
// Auth Schemas
// ============================================================================

export const githubOAuthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
})

// ============================================================================
// Repository Schemas
// ============================================================================

export const repositoryIdParamSchema = z.object({
  id: idSchema,
})

export const repositorySettingsUpdateSchema = z.object({
  pruningDays: z.number().int().min(1).max(365).optional(),
  ignoredPaths: z.array(z.string()).optional(),
  notifyOnNewOverlap: z.boolean().optional(),
  notifyOnSeverityIncrease: z.boolean().optional(),
})

// ============================================================================
// Branch Schemas
// ============================================================================

export const branchQuerySchema = z
  .object({
    includeDefault: z.coerce.boolean().default(false),
    includeStale: z.coerce.boolean().default(false),
  })
  .merge(paginationSchema)

// ============================================================================
// Overlap Schemas
// ============================================================================

export const overlapQuerySchema = z
  .object({
    status: z.enum(['active', 'resolved', 'ignored']).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    branchId: idSchema.optional(),
  })
  .merge(paginationSchema)

export const overlapUpdateSchema = z.object({
  status: z.enum(['active', 'resolved', 'ignored']),
})

// ============================================================================
// Webhook Schemas
// ============================================================================

export const webhookHeadersSchema = z.object({
  'x-github-event': z.string(),
  'x-github-delivery': z.string(),
  'x-hub-signature-256': z.string(),
})

export const pushEventSchema = z.object({
  ref: z.string(),
  before: z.string(),
  after: z.string(),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    default_branch: z.string(),
    private: z.boolean(),
  }),
  sender: z.object({
    id: z.number(),
    login: z.string(),
  }),
  installation: z.object({
    id: z.number(),
  }),
  commits: z.array(
    z.object({
      id: z.string(),
      added: z.array(z.string()),
      modified: z.array(z.string()),
      removed: z.array(z.string()),
    })
  ),
  forced: z.boolean().optional(),
  deleted: z.boolean().optional(),
})

export const pullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number(),
  pull_request: z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    state: z.enum(['open', 'closed']),
    head: z.object({
      ref: z.string(),
      sha: z.string(),
    }),
    base: z.object({
      ref: z.string(),
    }),
    merged: z.boolean().optional(),
  }),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
  }),
  installation: z.object({
    id: z.number(),
  }),
})

export const installationEventSchema = z.object({
  action: z.enum(['created', 'deleted', 'suspend', 'unsuspend']),
  installation: z.object({
    id: z.number(),
    account: z.object({
      id: z.number(),
      login: z.string(),
      type: z.enum(['User', 'Organization']),
      avatar_url: z.string().optional(),
    }),
  }),
  sender: z.object({
    id: z.number(),
    login: z.string(),
  }),
  repositories: z
    .array(
      z.object({
        id: z.number(),
        name: z.string(),
        full_name: z.string(),
        private: z.boolean(),
      })
    )
    .optional(),
})

// ============================================================================
// Type Exports
// ============================================================================

export type PaginationInput = z.infer<typeof paginationSchema>
export type GitHubOAuthCallback = z.infer<typeof githubOAuthCallbackSchema>
export type RepositorySettingsUpdate = z.infer<typeof repositorySettingsUpdateSchema>
export type BranchQuery = z.infer<typeof branchQuerySchema>
export type OverlapQuery = z.infer<typeof overlapQuerySchema>
export type OverlapUpdate = z.infer<typeof overlapUpdateSchema>
export type PushEvent = z.infer<typeof pushEventSchema>
export type PullRequestEvent = z.infer<typeof pullRequestEventSchema>
export type InstallationEvent = z.infer<typeof installationEventSchema>
