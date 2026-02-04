# Product Requirements Document (PRD)

## Product Name
**Overlap**

## One-line Description
Overlap is a standalone web application that detects overlapping file changes across active Git branches in real time and warns teams early—before merge conflicts turn into multi-day disasters.

---

## Problem Statement

Modern software teams increasingly use AI agents and parallel development workflows. Multiple agents (or humans + agents) work simultaneously on separate branches, often touching the same files without awareness of each other.

Git is optimized for mainline integration, not real-time cross-branch awareness. As a result:
- Large merge conflicts are discovered late (during PR merge)
- Conflicts are harder to resolve due to diverging context
- Developers lose hours or days resolving issues that could have been detected early
- AI agents amplify the problem by generating frequent, noisy commits

**Overlap exists to surface these conflicts early, when they are still small and cheap to resolve.**

---

## Goals

### Primary Goals
- Detect overlapping file edits across active branches in the same repository
- Warn developers early via GitHub-native signals
- Provide a standalone dashboard for visibility and configuration
- Reduce time spent resolving merge conflicts
- Be agent-friendly without requiring agent behavior changes

### Secondary Goals
- Improve developer awareness of parallel work
- Encourage healthier merge patterns (earlier rebases / merges)
- Provide a foundation for future agent coordination features

### Non-Goals (for MVP)
- Automatic conflict resolution
- AST-level or semantic merge analysis
- IDE plugins
- Replacing Git workflows

---

## Target Users

Primary audience: **developers working in teams on the same project.**

### Primary Users
- Software engineers working in teams
- Teams using AI coding agents (Copilot, Claude, Cursor, etc.)

### Secondary Users
- Engineering managers (lightweight visibility only)
- Open-source maintainers

---

## User Stories

### Developer
- As a developer, I want to know if someone else is modifying the same files in another branch so I can avoid painful merge conflicts later.
- As a developer, I want warnings to appear directly in GitHub without checking another dashboard.
- As a developer, I want to view overlaps across all branches in my repo in one place.

### AI Agent Workflow
- As an agent-driven workflow, I want conflicts surfaced automatically without requiring agent coordination.

---

## Core Features (MVP)

### 1. Standalone Web Application

- Login via GitHub
- Organization and repository selection
- Dashboard showing:
  - Active branches
  - Current overlaps
  - Recently detected conflicts
- Repo-level configuration UI

---

### 2. GitHub Integration (via GitHub App)

Overlap uses a GitHub App for webhook ingestion and PR feedback.

Permissions:
- Read repository contents
- Read metadata
- Write PR comments
- Write GitHub Checks

---

### 3. Webhook Processing

#### Supported Events
- `push`
- `pull_request` (opened, reopened, synchronize)

#### Behavior
- On each push, Overlap:
  - Identifies the branch
  - Fetches changed files from the commit range
  - Updates an internal branch → file index

---

### 4. Branch File Index

Overlap maintains a real-time view of which branches have modified which files.

#### Data Stored
- Repository ID
- Branch name
- File path
- Last commit SHA
- Timestamp of last modification

This index is continuously updated and pruned to avoid stale data.

---

### 5. Overlap Detection Engine

When a branch updates:

1. Compare its modified files against other active branches in the same repo
2. Identify intersecting file paths
3. Exclude:
   - The same branch
   - Default branch

#### Output
- List of overlapping branches
- Files in conflict
- Conflict count per branch

---

### 6. GitHub Feedback

#### Pull Request Comments

> ⚠️ **Potential overlap detected**  \
> This branch modifies files also changed in:
> - `feature/auth-agent` (3 files)
> - `refactor/users` (1 file)

#### GitHub Check Runs
- Non-blocking warning check
- Appears alongside CI
- Status: `neutral` or `warning`

---

## UX Principles

- GitHub-native alerts + standalone visibility
- Early and actionable, not noisy
- Informational, not blocking
- Clear language over technical jargon
- Dashboard favors clarity over density

---

## Installation Flow

1. User signs in with GitHub
2. User selects organization
3. User selects repositories (via GitHub App install)
4. Initial repository sync begins
5. Dashboard populated

OAuth and GitHub App installation are presented as a single guided setup flow.

---

## Initial Repository Sync

When a repository is first connected:
- Index **all active branches**
- Record latest commit per branch
- Populate BranchFile records
- Suppress overlap notifications until the first new push event

This prevents alert spam on initial install.

---

## Alert Rules (MVP)

- Notify once per PR unless severity increases
- Deduplicate alerts per PR
- Default branch changes do not trigger alerts
- Alerts are informational only (non-blocking)

---

## Data Handling

- File paths, branch metadata, and commit SHAs are stored
- File contents are never persisted
- Commit diffs are processed transiently
- Raw overlap data is retained indefinitely
- Dashboard statistics and aggregates are limited to a rolling 30-day window

---

## Branch Lifecycle

- Branches inactive for a configurable period (default: **14 days**) are automatically pruned
- Deleted branches cleaned up via webhook or scheduled job

---

## Failure Handling (MVP)

- Webhook retries supported
- Failed background jobs requeued
- GitHub API failures logged and retried
- Dashboard reflects degraded or delayed processing states

---

## Technical Architecture (High-Level)

### Components

- React Frontend
- Fastify Backend API
- GitHub App
- Webhook Receiver
- Background Workers
- Conflict Detection Engine
- PostgreSQL
- Redis

### Data Flow

1. User authenticates via GitHub
2. GitHub App receives webhook
3. Event enqueued for background processing
4. Changed files fetched via GitHub API
5. Branch file index updated
6. Overlap detection executed
7. Results:
   - Sent to GitHub (PR comments + checks)
   - Stored for dashboard display

---

## Tech Stack

### Frontend
- React
- TanStack Start
- Vite
- TypeScript

### UI Components
- shadcn/ui
- Tailwind CSS

### Backend
- Language: TypeScript
- Runtime: Node.js 20+
- Framework: Fastify

### GitHub Integration
- GitHub App
- GitHub OAuth
- Libraries:
  - `@octokit/rest`
  - `@octokit/webhooks`

### Background Processing
- Queue: BullMQ
- Broker: Redis

### Database
- Managed PostgreSQL (Railway)

Used for:
- Users / organizations
- Repository metadata
- Branch tracking
- Branch → file index
- Historical overlaps

### Hosting / Infrastructure
- Primary Hosting: Railway (backend, workers, frontend)
- Database: Railway Managed PostgreSQL
- Redis: Railway add-on or external
- Secrets: Railway environment variables

### Observability (MVP)
- Structured logging
- Basic error tracking

---

## Data Model (Simplified)

### User
- id
- github_id

### Organization
- id
- github_org_id

### Repository
- id
- organization_id
- name

### Branch
- id
- repository_id
- name
- last_seen_at

### BranchFile
- branch_id
- file_path
- last_commit_sha
- updated_at

---

## Edge Cases & Considerations

- Rapid agent pushes
- Branch deletion cleanup
- Force pushes
- Rebases
- Large monorepos
- OAuth permission changes

---

## Metrics & Success Criteria

### Product Metrics
- Overlaps detected
- Overlaps detected before PR merge
- Reduction in merge conflicts (qualitative)

### Adoption Metrics
- Active repositories
- Weekly overlaps surfaced

---

## Risks

- False positives from file-level detection
- Notification fatigue
- Performance on large repos

Mitigation: keep MVP informational and configurable.

---

## MVP Build Checklist

### Version 0.1 — Core Detection

- [ ] GitHub login + repo selection
- [ ] GitHub App installation
- [ ] Webhook ingestion
- [ ] Background queue
- [ ] Branch/file indexing
- [ ] Overlap detection
- [ ] PR comments
- [ ] GitHub Checks
- [ ] Minimal dashboard (repos + current overlaps)

---

### Version 0.2 — Stability

- [ ] Stale branch pruning
- [ ] Force push handling
- [ ] Branch deletion cleanup
- [ ] Notification deduplication
- [ ] Rate limiting

---

### Version 0.3 — Agent-Friendly

- [ ] Conflict severity scoring
- [ ] Improved dashboard UX
- [ ] Optional Slack notifications

---

### Version 0.4 — Smarter Detection

- [ ] Line-range overlap detection
- [ ] Experimental AST diffing
- [ ] Monorepo optimizations

---

### Version 0.5 — Insights & Coordination

- [ ] Historical overlap analytics
- [ ] Merge-order suggestions
- [ ] Temporary integration branches

---

## Open Questions

- What constitutes severity increase (file count vs line overlap)?
- Should users be able to manually mark overlaps as resolved?

---

## Summary

Overlap is a standalone application that brings early visibility to parallel development collisions—especially in agent-driven workflows—by detecting overlapping file changes across branches and surfacing warnings directly inside GitHub while providing centralized insight via a web dashboard.

By focusing on early detection rather than resolution, Overlap reduces merge pain while preserving existing workflows.

