<p align="center">
  <img src="apps/web/public/favicon.svg" width="88" alt="Overlap logo" />
</p>

<h1 align="center">Overlap</h1>

<p align="center">
  Detect overlapping file changes across active Git branches in real time,
  before they become merge conflicts.
</p>

---

## The problem

Modern teams run parallel development hard: multiple developers, plus AI coding agents, each pushing frequent commits on their own branches.
Git is built for mainline integration, not cross-branch awareness, so nobody finds out two branches touched the same files until one of them opens a pull request.
By then the branches have diverged, the context is gone, and what would have been a two-minute conversation is a multi-hour merge.

Overlap watches every push across your active branches, keeps an index of who changed what, and warns you the moment two branches start editing the same files.
Warnings arrive where you already work: as a pull request comment, a non-blocking check run, a browser push notification, and a dashboard.

Agents make this worse, not better.
They generate more branches and more commits than humans do, and they do not coordinate with each other.
Overlap surfaces the collisions automatically without requiring any change to how your agents (or humans) work.

## How it works

1. A GitHub App delivers `push` and `pull_request` webhooks to Overlap.
2. Each push updates a branch-to-files index: which branches changed which paths, at which commit, and when.
3. On every update, the changed paths are intersected against every other active branch in the repository (the default branch and same branch are excluded).
4. Each overlap gets a severity (`low`, `medium`, `high`, `critical`) based on how much the branches collide.
5. Feedback goes out through GitHub-native channels:
   - a comment on affected pull requests listing the overlapping branches and files
   - a non-blocking check run that appears alongside CI (never fails your build)
   - an optional browser push notification
   - the dashboard, where overlaps can be inspected, resolved, or ignored

Alerts are informational and deduplicated: one notification per PR unless the severity increases, and nothing fires during the initial sync of a freshly connected repository.

## Features

- **Real-time detection** - overlaps appear as soon as changes are pushed, not at PR time
- **GitHub-native feedback** - PR comments and check runs, no new tool to watch
- **Dashboard** - active branches, current overlaps, and recent activity per repository
- **Per-repository settings** - ignored paths (glob patterns), branch pruning window, notification toggles
- **Web push notifications** - opt-in browser notifications for new or escalating overlaps
- **Stale branch pruning** - branches with no activity inside the pruning window (default 14 days) drop out of detection automatically
- **Sign-up allowlist** - gate your instance to specific GitHub accounts, so a public deployment stays private

## Architecture

Overlap is a pnpm + Turborepo monorepo with a single deployable app.

```
apps/
  web/          TanStack Start (React 19, SSR) - UI, API routes, webhooks,
                durable workflows, and cron handlers in one Vercel deployment
packages/
  db/           Drizzle ORM schema and Postgres client
  github/       GitHub App auth and API helpers
  shared/       Types and Zod validation shared across packages
```

| Concern | Choice |
| --- | --- |
| Web framework | [TanStack Start](https://tanstack.com/start) with SSR on Vite |
| Database | PostgreSQL via [Drizzle ORM](https://orm.drizzle.team) (Neon in production, Docker locally) |
| Background work | [Vercel Workflow](https://vercel.com/docs/workflow) durable workflows (webhook processing survives retries and redeploys) |
| Auth | GitHub OAuth with signed HttpOnly session cookies (JWT, HS256) |
| GitHub integration | GitHub App (webhooks in, comments and check runs out) |
| Notifications | Web Push (VAPID) |
| Hosting | Vercel (functions + crons), works anywhere Node 20+ runs |

Webhook deliveries are verified against the App's webhook secret, recorded with a unique delivery id for idempotency, and processed by a durable workflow so a crashed or redeployed function never drops an event.

## Self-hosting

### Prerequisites

- Node.js 20+
- pnpm 9 (`corepack enable`)
- PostgreSQL 16 (or `docker compose up -d` for a local one)
- A GitHub account that can create a GitHub App

### 1. Create a GitHub App

Create a new GitHub App (Settings -> Developer settings -> GitHub Apps) with:

**Permissions**

| Permission | Access |
| --- | --- |
| Contents | Read-only |
| Metadata | Read-only |
| Pull requests | Read and write |
| Checks | Read and write |

**Events**: `push`, `pull_request`

**URLs** (replace with your deployment URL, `http://localhost:3000` for local dev)

| Setting | Value |
| --- | --- |
| Homepage URL | `https://your-domain.example` |
| Callback URL | `https://your-domain.example/api/auth/github/callback` |
| Webhook URL | `https://your-domain.example/api/webhooks/github` |

Enable **Request user authorization (OAuth) during installation**, generate a **private key**, and set a **webhook secret**.

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (pooled) |
| `DIRECT_URL` | Direct Postgres connection (migrations) |
| `GITHUB_APP_ID` | From the App's settings page |
| `GITHUB_APP_SLUG` | The App's URL slug, used for install links |
| `GITHUB_APP_PRIVATE_KEY` | The generated private key (PEM, `\n`-escaped) |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret you set |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | The App's OAuth credentials |
| `SESSION_SECRET` | 32+ random bytes for signing session cookies |
| `APP_URL` | The public URL of your deployment |
| `CRON_SECRET` | Random bytes; authorizes the cron endpoints |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push keys (`npx web-push generate-vapid-keys`) |
| `VITE_VAPID_PUBLIC_KEY` | Same public key, exposed to the browser |
| `VITE_GITHUB_APP_SLUG` | Same slug, exposed to the browser |
| `ALLOWED_GITHUB_USERS` | Comma-separated GitHub logins allowed to sign up (see below) |

### 3. Run locally

```bash
pnpm install
docker compose up -d        # local Postgres 16
pnpm db:push                # create the schema
pnpm dev                    # http://localhost:3000
```

Sign in with GitHub, install the App on a repository, and push to a branch.
For webhooks to reach a local instance you will need a tunnel (for example `cloudflared` or `ngrok`) pointed at port 3000, with the App's webhook URL set to the tunnel address.

### 4. Deploy

Overlap deploys as a single Vercel project:

- **Root Directory**: `apps/web`
- Connect the Git repository so merges to `main` deploy automatically
- Set every variable from step 2 in the project's environment
- `apps/web/vercel.json` registers the two cron jobs:
  - `/api/cron/prune-branches` every 6 hours (drops stale branches from detection)
  - `/api/cron/cleanup-events` daily (removes processed webhook events)

Both cron endpoints require the `CRON_SECRET` bearer token, which Vercel sends automatically.

## Restricting sign-ups

Any GitHub user can complete OAuth against a public deployment, so first-time sign-ups are gated by an allowlist:

- `ALLOWED_GITHUB_USERS=alice,bob` - only these GitHub logins can create an account
- Unset in production - **no new sign-ups at all** (fail closed; a forgotten variable locks the door rather than opening it)
- Unset in development - anyone can sign up, so local work is frictionless

Existing users are always admitted: accounts are matched on the immutable GitHub user id before the allowlist is consulted, so editing the list can never lock out someone who already signed up, and a GitHub username change does not cost anyone their account.
Blocked visitors land on the login page with a clear "sign-ups are closed" notice.

## Per-repository settings

Each connected repository has its own settings page:

| Setting | Default | Effect |
| --- | --- | --- |
| Pruning window | 14 days | Branches with no pushes inside the window leave the index |
| Ignored paths | `[]` | Glob patterns excluded from detection (lockfiles, generated code) |
| Notify on new overlap | on | Push notification when a new overlap appears |
| Notify on severity increase | on | Push notification when an existing overlap escalates |

## Development

```bash
pnpm dev                 # all workspaces in watch mode
pnpm test                # unit tests (Vitest)
pnpm test:integration    # integration tests (PGlite, no external DB needed)
pnpm typecheck           # strict TypeScript across the monorepo
pnpm lint                # ESLint
pnpm db:studio           # Drizzle Studio against your local DB
```

The test suite covers the overlap engine, webhook signature verification and ordering, the durable workflow steps, session handling, and the sign-up gate (including a mutation-tested guarantee that a disabled gate fails the suite).

## Status and roadmap

Overlap is young and running in production for a small set of repositories.
The near-term direction:

- **Pluggable auth and user storage** - let self-hosters bring their own identity backend instead of the built-in GitHub OAuth + Postgres pair
- Smarter severity: weigh line-level proximity, not just file intersection
- Org-level views across repositories

Issues and PRs are welcome.
A good first contribution is running it against your own repositories and reporting where the signal-to-noise ratio falls down.

## License

[MIT](LICENSE)
