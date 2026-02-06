import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  bigint,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ============================================================================
// Users & Auth
// ============================================================================

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
    username: varchar('username', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('users_github_id_idx').on(table.githubId)]
)

// ============================================================================
// Organizations & Installations
// ============================================================================

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('organizations_github_id_idx').on(table.githubId)]
)

export const githubAppInstallations = pgTable(
  'github_app_installations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    installationId: bigint('installation_id', { mode: 'number' }).notNull().unique(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 50 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('installations_installation_id_idx').on(table.installationId)]
)

// ============================================================================
// Repositories
// ============================================================================

export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    githubId: bigint('github_id', { mode: 'number' }).notNull().unique(),
    installationId: uuid('installation_id')
      .notNull()
      .references(() => githubAppInstallations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    fullName: varchar('full_name', { length: 512 }).notNull(),
    defaultBranch: varchar('default_branch', { length: 255 }).notNull().default('main'),
    isPrivate: boolean('is_private').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('repositories_github_id_idx').on(table.githubId),
    index('repositories_installation_id_idx').on(table.installationId),
    index('repositories_full_name_idx').on(table.fullName),
  ]
)

export const repositorySettings = pgTable('repository_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  repositoryId: uuid('repository_id')
    .notNull()
    .unique()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  pruningDays: integer('pruning_days').notNull().default(14),
  ignoredPaths: jsonb('ignored_paths').$type<string[]>().notNull().default([]),
  notifyOnNewOverlap: boolean('notify_on_new_overlap').notNull().default(true),
  notifyOnSeverityIncrease: boolean('notify_on_severity_increase').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// ============================================================================
// Branches & Files
// ============================================================================

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    sha: varchar('sha', { length: 40 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    lastPusherGithubId: bigint('last_pusher_github_id', { mode: 'number' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('branches_repo_name_idx').on(table.repositoryId, table.name),
    index('branches_repository_id_idx').on(table.repositoryId),
    index('branches_last_seen_at_idx').on(table.lastSeenAt),
  ]
)

export const branchFiles = pgTable(
  'branch_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    changeType: varchar('change_type', { length: 20 }).notNull(), // added, modified, deleted, renamed
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('branch_files_branch_path_idx').on(table.branchId, table.filePath),
    index('branch_files_branch_id_idx').on(table.branchId),
    index('branch_files_file_path_idx').on(table.filePath),
  ]
)

// ============================================================================
// Overlaps
// ============================================================================

export const overlaps = pgTable(
  'overlaps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    sourceBranchId: uuid('source_branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    targetBranchId: uuid('target_branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    fileCount: integer('file_count').notNull().default(0),
    severity: varchar('severity', { length: 20 }).notNull().default('low'), // low, medium, high, critical
    status: varchar('status', { length: 20 }).notNull().default('active'), // active, resolved, ignored
    detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('overlaps_branches_idx').on(table.sourceBranchId, table.targetBranchId),
    index('overlaps_repository_id_idx').on(table.repositoryId),
    index('overlaps_status_idx').on(table.status),
    index('overlaps_severity_idx').on(table.severity),
  ]
)

export const overlapFiles = pgTable(
  'overlap_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    overlapId: uuid('overlap_id')
      .notNull()
      .references(() => overlaps.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    sourceChangeType: varchar('source_change_type', { length: 20 }).notNull(),
    targetChangeType: varchar('target_change_type', { length: 20 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('overlap_files_overlap_path_idx').on(table.overlapId, table.filePath),
    index('overlap_files_overlap_id_idx').on(table.overlapId),
  ]
)

// ============================================================================
// Pull Requests & Alerts
// ============================================================================

export const pullRequests = pgTable(
  'pull_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    githubPrNumber: integer('github_pr_number').notNull(),
    title: text('title').notNull(),
    state: varchar('state', { length: 20 }).notNull().default('open'), // open, closed, merged
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('pull_requests_repo_number_idx').on(table.repositoryId, table.githubPrNumber),
    index('pull_requests_repository_id_idx').on(table.repositoryId),
    index('pull_requests_branch_id_idx').on(table.branchId),
    index('pull_requests_state_idx').on(table.state),
  ]
)

export const prAlerts = pgTable(
  'pr_alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pullRequestId: uuid('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    overlapId: uuid('overlap_id')
      .notNull()
      .references(() => overlaps.id, { onDelete: 'cascade' }),
    alertType: varchar('alert_type', { length: 20 }).notNull(), // comment, check_run, both
    commentId: bigint('comment_id', { mode: 'number' }),
    checkRunId: bigint('check_run_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('pr_alerts_pr_overlap_idx').on(table.pullRequestId, table.overlapId),
    index('pr_alerts_pull_request_id_idx').on(table.pullRequestId),
    index('pr_alerts_overlap_id_idx').on(table.overlapId),
  ]
)

// ============================================================================
// Webhook Events
// ============================================================================

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    deliveryId: varchar('delivery_id', { length: 100 }).notNull().unique(),
    repositoryId: uuid('repository_id').references(() => repositories.id, {
      onDelete: 'set null',
    }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('webhook_events_delivery_id_idx').on(table.deliveryId),
    index('webhook_events_event_type_idx').on(table.eventType),
    index('webhook_events_created_at_idx').on(table.createdAt),
  ]
)

// ============================================================================
// Push Subscriptions
// ============================================================================

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('push_subscriptions_user_id_idx').on(table.userId),
    uniqueIndex('push_subscriptions_user_endpoint_idx').on(table.userId, table.endpoint),
  ]
)

// ============================================================================
// Relations
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  installations: many(githubAppInstallations),
  pushSubscriptions: many(pushSubscriptions),
}))

export const organizationsRelations = relations(organizations, ({ many }) => ({
  installations: many(githubAppInstallations),
}))

export const githubAppInstallationsRelations = relations(githubAppInstallations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [githubAppInstallations.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [githubAppInstallations.userId],
    references: [users.id],
  }),
  repositories: many(repositories),
}))

export const repositoriesRelations = relations(repositories, ({ one, many }) => ({
  installation: one(githubAppInstallations, {
    fields: [repositories.installationId],
    references: [githubAppInstallations.id],
  }),
  settings: one(repositorySettings, {
    fields: [repositories.id],
    references: [repositorySettings.repositoryId],
  }),
  branches: many(branches),
  overlaps: many(overlaps),
  pullRequests: many(pullRequests),
  webhookEvents: many(webhookEvents),
}))

export const repositorySettingsRelations = relations(repositorySettings, ({ one }) => ({
  repository: one(repositories, {
    fields: [repositorySettings.repositoryId],
    references: [repositories.id],
  }),
}))

export const branchesRelations = relations(branches, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [branches.repositoryId],
    references: [repositories.id],
  }),
  files: many(branchFiles),
  sourceOverlaps: many(overlaps, { relationName: 'sourceOverlaps' }),
  targetOverlaps: many(overlaps, { relationName: 'targetOverlaps' }),
  pullRequests: many(pullRequests),
}))

export const branchFilesRelations = relations(branchFiles, ({ one }) => ({
  branch: one(branches, {
    fields: [branchFiles.branchId],
    references: [branches.id],
  }),
}))

export const overlapsRelations = relations(overlaps, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [overlaps.repositoryId],
    references: [repositories.id],
  }),
  sourceBranch: one(branches, {
    fields: [overlaps.sourceBranchId],
    references: [branches.id],
    relationName: 'sourceOverlaps',
  }),
  targetBranch: one(branches, {
    fields: [overlaps.targetBranchId],
    references: [branches.id],
    relationName: 'targetOverlaps',
  }),
  files: many(overlapFiles),
  alerts: many(prAlerts),
}))

export const overlapFilesRelations = relations(overlapFiles, ({ one }) => ({
  overlap: one(overlaps, {
    fields: [overlapFiles.overlapId],
    references: [overlaps.id],
  }),
}))

export const pullRequestsRelations = relations(pullRequests, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [pullRequests.repositoryId],
    references: [repositories.id],
  }),
  branch: one(branches, {
    fields: [pullRequests.branchId],
    references: [branches.id],
  }),
  alerts: many(prAlerts),
}))

export const prAlertsRelations = relations(prAlerts, ({ one }) => ({
  pullRequest: one(pullRequests, {
    fields: [prAlerts.pullRequestId],
    references: [pullRequests.id],
  }),
  overlap: one(overlaps, {
    fields: [prAlerts.overlapId],
    references: [overlaps.id],
  }),
}))

export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  repository: one(repositories, {
    fields: [webhookEvents.repositoryId],
    references: [repositories.id],
  }),
}))

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [pushSubscriptions.userId],
    references: [users.id],
  }),
}))
