# Vercel Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Overlap from three Railway services plus Redis onto a single Vercel project backed by Supabase, replacing the always-on BullMQ worker with Workflow DevKit durable workflows.

**Architecture:** `apps/web` absorbs the Fastify API as TanStack Start server routes and the BullMQ worker as WDK workflows. Redis and BullMQ are deleted outright. Each GitHub webhook delivery becomes one durable workflow run whose steps execute in a guaranteed order, replacing six independent queues that had no ordering between them.

**Tech Stack:** TanStack Start (React 19, Vite 7), Nitro, Workflow DevKit 4.8.2, Drizzle ORM, `postgres-js`, Supabase Postgres, `jose`, Vitest, Vercel.

**Spec:** `docs/superpowers/specs/2026-08-12-vercel-migration-design.md`

## Global Constraints

- Node `>=20.0.0`, pnpm `9.15.0`, ESM only (`"type": "module"` in every package).
- Workflow DevKit is `workflow@4.8.2`, installed in `apps/web`. Its authoritative docs are at `apps/web/node_modules/workflow/docs/`. Read those, not memory.
- `"use workflow"` functions run sandboxed with no Node.js access. All I/O lives in `"use step"` functions.
- Step default is `maxRetries = 3`, meaning up to 4 total attempts.
- No em dashes in any file, per the repository's authoring conventions.
- HMAC verification of the raw webhook body precedes every database write and every workflow start. This ordering is a security requirement, not a preference (spec S2).
- The session token carries `userId` only. The per-request database lookup is retained (spec S4).
- `packages/github`, `packages/db` schema, and `packages/shared` validation are carried across unchanged unless a task says otherwise.

---

## Correction to the spec, discovered while reading WDK docs

The spec's idempotency section claims that step memoization prevents a retry from re-posting a check run. That is only true for a step that has already completed. A step that calls GitHub successfully and then fails before returning will retry and call GitHub again.

`apps/web/node_modules/workflow/docs/foundations/idempotency.mdx` is explicit about this and is the payment-charge example verbatim.

GitHub's check run API accepts no idempotency key, and creating a second check run with the same name on the same SHA produces a visible duplicate rather than an update. Task 9 addresses this by adding `updateCheckRun` to the GitHub client and having `postCheckRun` update the existing `pr_alerts.checkRunId` when one is present.

A second finding: `packages/github/src/client.ts:15` defines a `withRetry` helper that already retries on rate limits internally. Under WDK this double-retries, because the step wrapper retries too, and the inner retry burns the step's wall-clock budget. Task 9 removes `withRetry` and lets WDK own retry policy.

---

## Phase 1: Foundations

### Task 1: Test infrastructure

The repository currently has no test runner, no test script, and no tests. Every later task in this plan is written test-first, so this must exist first.

**Files:**
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/lib/__tests__/smoke.test.ts`
- Modify: `apps/web/package.json`
- Modify: `turbo.json`

**Interfaces:**
- Consumes: nothing
- Produces: `pnpm --filter @overlap/web test` runs Vitest. `pnpm test` runs it through Turborepo.

- [ ] **Step 1: Install Vitest**

```bash
pnpm --filter @overlap/web add -D vitest
```

- [ ] **Step 2: Write the Vitest config**

```typescript
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 3: Write a smoke test that fails**

```typescript
// apps/web/src/lib/__tests__/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(3)
  })
})
```

- [ ] **Step 4: Add the test script**

In `apps/web/package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

In `turbo.json`, add to `"tasks"`:

```json
"test": {
  "dependsOn": ["^build"],
  "outputs": []
}
```

- [ ] **Step 5: Run the test and confirm it fails**

Run: `pnpm --filter @overlap/web test`
Expected: FAIL, `expected 2 to be 3`

- [ ] **Step 6: Correct the assertion**

Change `toBe(3)` to `toBe(2)` in the smoke test.

- [ ] **Step 7: Run the test and confirm it passes**

Run: `pnpm --filter @overlap/web test`
Expected: PASS, 1 test.

- [ ] **Step 8: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/src/lib/__tests__/smoke.test.ts apps/web/package.json turbo.json pnpm-lock.yaml
git commit -m "test: add Vitest to web app"
```

---

### Task 2: Vite and Nitro configuration for Vercel and WDK

**Files:**
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/tsconfig.json`

**Interfaces:**
- Consumes: nothing
- Produces: `"use workflow"` and `"use step"` directives compile. Build output targets Vercel.

The current config at `apps/web/vite.config.ts:22` uses `preset: 'node_server'` and proxies `/auth` and `/api` to a separate API server in both dev (`server.proxy`) and production (`nitro.routeRules`). Once the API is folded in, all of that must go.

- [ ] **Step 1: Rewrite the Vite config**

```typescript
// apps/web/vite.config.ts
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import { workflow } from 'workflow/vite'

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
  },
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    workflow(),
    tanstackStart(),
    nitro({
      preset: 'vercel',
    }),
    viteReact(),
  ],
})
```

Note the ordering. `workflow()` comes before `tanstackStart()`, as shown in `apps/web/node_modules/workflow/docs/getting-started/tanstack-start.mdx`.

- [ ] **Step 2: Add the WDK TypeScript plugin**

In `apps/web/tsconfig.json`, add under `compilerOptions`:

```json
"plugins": [{ "name": "workflow" }]
```

- [ ] **Step 3: Verify the build succeeds**

Run: `pnpm --filter @overlap/web build`
Expected: build completes, output written to `.vercel/output` or `.output` depending on preset resolution. Any failure here is a configuration problem and must be resolved before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/vite.config.ts apps/web/tsconfig.json
git commit -m "build: target Vercel preset and enable Workflow DevKit plugin"
```

---

### Task 3: Database client for Supabase transaction pooling

**Files:**
- Modify: `packages/db/src/client.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing
- Produces: `db` (unchanged export, now pooler-safe), `migrationClient` (now uses `DIRECT_URL`).

Supavisor transaction mode cannot support prepared statements, and `postgres-js` enables them by default. Without `prepare: false` the app fails intermittently under concurrency with `prepared statement "s1" already exists`.

- [ ] **Step 1: Rewrite the client**

```typescript
// packages/db/src/client.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.js'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// Supabase Supavisor transaction pooler (port 6543) cannot use prepared statements.
const queryClient = postgres(connectionString, { prepare: false })

// Migrations require session mode, so they use the direct connection (port 5432).
const directConnectionString = process.env.DIRECT_URL || connectionString

export const migrationClient = postgres(directConnectionString, {
  max: 1,
  prepare: false,
})

export const db = drizzle(queryClient, { schema })

export type Database = typeof db
```

- [ ] **Step 2: Update `.env.example`**

Replace the `# Database` and `# Redis` blocks with:

```
# Database (Supabase)
# Transaction pooler, port 6543, used by the application
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/overlap
# Direct connection, port 5432, used by migrations only
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/overlap
```

Delete the `REDIS_URL` line entirely.

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm --filter @overlap/db typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/client.ts .env.example
git commit -m "feat(db): configure client for Supabase transaction pooling"
```

---

## Phase 2: Session and route fold-in

### Task 4: Session token utility

**Files:**
- Create: `apps/web/src/lib/session.ts`
- Create: `apps/web/src/lib/__tests__/session.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `signSession(userId: string): Promise<string>`
  - `verifySession(token: string): Promise<{ userId: string } | null>`
  - `SESSION_COOKIE_NAME: string` (value `"session"`)
  - `SESSION_MAX_AGE_SECONDS: number` (value `604800`)

Spec S4 requires: `userId` only in the token, algorithm pinned explicitly on verify, `exp` of seven days.

- [ ] **Step 1: Install jose**

```bash
pnpm --filter @overlap/web add jose
```

- [ ] **Step 2: Write the failing tests**

```typescript
// apps/web/src/lib/__tests__/session.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { signSession, verifySession } from '../session'

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-secret-value-at-least-32-bytes-long'
})

describe('session', () => {
  it('round-trips a userId', async () => {
    const token = await signSession('user-123')
    const result = await verifySession(token)
    expect(result).toEqual({ userId: 'user-123' })
  })

  it('rejects a tampered token', async () => {
    const token = await signSession('user-123')
    const tampered = token.slice(0, -4) + 'aaaa'
    expect(await verifySession(tampered)).toBeNull()
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signSession('user-123')
    process.env.SESSION_SECRET = 'a-completely-different-secret-value-32b'
    const result = await verifySession(token)
    process.env.SESSION_SECRET = 'test-secret-value-at-least-32-bytes-long'
    expect(result).toBeNull()
  })

  it('rejects a malformed token', async () => {
    expect(await verifySession('not-a-jwt')).toBeNull()
  })

  it('carries no claims beyond userId, iat and exp', async () => {
    const token = await signSession('user-123')
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString()
    )
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'userId'])
  })
})
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm --filter @overlap/web test`
Expected: FAIL, cannot resolve `../session`.

- [ ] **Step 4: Implement the session utility**

```typescript
// apps/web/src/lib/session.ts
import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE_NAME = 'session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

const ALGORITHM = 'HS256'

function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required')
  }
  return new TextEncoder().encode(secret)
}

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getKey())
}

export async function verifySession(
  token: string
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: [ALGORITHM],
    })
    const userId = payload.userId
    if (typeof userId !== 'string') return null
    return { userId }
  } catch {
    return null
  }
}
```

The `algorithms: [ALGORITHM]` option is required. Without it, `jose` would accept whatever algorithm the token header claims, which is the algorithm confusion class of vulnerability.

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --filter @overlap/web test`
Expected: PASS, 5 session tests plus the smoke test.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/session.ts apps/web/src/lib/__tests__/session.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add jose-backed session token utility"
```

---

### Task 5: Auth helper for server routes

**Files:**
- Create: `apps/web/src/lib/auth.ts`
- Create: `apps/web/src/lib/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `signSession`, `verifySession`, `SESSION_COOKIE_NAME` from Task 4
- Produces:
  - `getUser(request: Request): Promise<AuthUser | null>`
  - `requireUser(request: Request): Promise<AuthUser>` which throws a `Response` with status 401
  - `type AuthUser = { id: string; githubId: number; username: string; email: string | null; avatarUrl: string | null }`
  - `readCookie(request: Request, name: string): string | null`
  - `buildSessionCookie(token: string): string`
  - `buildClearCookie(name: string): string`

This is the direct port of `apps/api/src/plugins/auth.ts`. The database lookup on every request is retained deliberately, per spec S4.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/lib/__tests__/auth.test.ts
import { describe, it, expect } from 'vitest'
import { readCookie, buildSessionCookie, buildClearCookie } from '../auth'

function reqWithCookie(value: string): Request {
  return new Request('https://example.com/', { headers: { cookie: value } })
}

describe('readCookie', () => {
  it('reads a single cookie', () => {
    expect(readCookie(reqWithCookie('session=abc'), 'session')).toBe('abc')
  })

  it('reads one cookie among several', () => {
    const r = reqWithCookie('a=1; session=abc; b=2')
    expect(readCookie(r, 'session')).toBe('abc')
  })

  it('returns null when absent', () => {
    expect(readCookie(reqWithCookie('a=1'), 'session')).toBeNull()
  })

  it('returns null when there is no cookie header', () => {
    expect(readCookie(new Request('https://example.com/'), 'session')).toBeNull()
  })

  it('does not match a cookie whose name is a suffix', () => {
    expect(readCookie(reqWithCookie('oauth_session=abc'), 'session')).toBeNull()
  })
})

describe('buildSessionCookie', () => {
  it('sets HttpOnly, SameSite=Lax and Path', () => {
    const c = buildSessionCookie('tok')
    expect(c).toContain('session=tok')
    expect(c).toContain('HttpOnly')
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Path=/')
    expect(c).toContain('Max-Age=604800')
  })
})

describe('buildClearCookie', () => {
  it('expires the cookie immediately', () => {
    expect(buildClearCookie('session')).toContain('Max-Age=0')
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @overlap/web test`
Expected: FAIL, cannot resolve `../auth`.

- [ ] **Step 3: Implement the auth helper**

```typescript
// apps/web/src/lib/auth.ts
import { db, users } from '@overlap/db'
import { eq } from 'drizzle-orm'
import {
  verifySession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from './session'

export type AuthUser = {
  id: string
  githubId: number
  username: string
  email: string | null
  avatarUrl: string | null
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim()
    }
  }
  return null
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function buildSessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ]
  if (isProduction()) parts.push('Secure')
  return parts.join('; ')
}

export function buildClearCookie(name: string): string {
  const parts = [`${name}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
  if (isProduction()) parts.push('Secure')
  return parts.join('; ')
}

export async function getUser(request: Request): Promise<AuthUser | null> {
  const token = readCookie(request, SESSION_COOKIE_NAME)
  if (!token) return null

  const session = await verifySession(token)
  if (!session) return null

  // Retained deliberately: this lookup is what makes revocation immediate.
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  })
  if (!user) return null

  return {
    id: user.id,
    githubId: user.githubId,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
  }
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const user = await getUser(request)
  if (!user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  return user
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @overlap/web test`
Expected: PASS, all auth and session tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/auth.ts apps/web/src/lib/__tests__/auth.test.ts
git commit -m "feat(web): add request auth helper with retained user lookup"
```

---

### Task 6: Health and auth server routes

**Files:**
- Create: `apps/web/src/routes/api/health.ts`
- Create: `apps/web/src/routes/api/auth/github.ts`
- Create: `apps/web/src/routes/api/auth/github.callback.ts`
- Create: `apps/web/src/routes/api/auth/me.ts`
- Create: `apps/web/src/routes/api/auth/logout.ts`
- Create: `apps/web/src/lib/github-oauth.ts`
- Reference: `apps/api/src/routes/auth.ts`, `apps/api/src/routes/health.ts`

**Interfaces:**
- Consumes: `getUser`, `requireUser`, `buildSessionCookie`, `buildClearCookie`, `readCookie` from Task 5, `signSession` from Task 4
- Produces: `syncUserInstallations(accessToken: string, userId: string): Promise<void>` exported from `apps/web/src/lib/github-oauth.ts`

Per spec S9, the health route drops its Redis check. Per spec S7, the `oauth_state` cookie keeps integrity protection, which here means it is itself a signed JWT rather than a bare random value.

- [ ] **Step 1: Write the health route**

```typescript
// apps/web/src/routes/api/health.ts
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { db } from '@overlap/db'
import { sql } from 'drizzle-orm'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        let database = false
        try {
          await db.execute(sql`SELECT 1`)
          database = true
        } catch {
          database = false
        }

        return json(
          {
            status: database ? 'ready' : 'not ready',
            checks: { database },
            timestamp: new Date().toISOString(),
          },
          { status: database ? 200 : 503 }
        )
      },
    },
  },
})
```

- [ ] **Step 2: Port `syncUserInstallations` verbatim**

Copy the `syncUserInstallations` function from `apps/api/src/routes/auth.ts` into `apps/web/src/lib/github-oauth.ts`, changing only its imports to point at `@overlap/db`. Export it. Do not alter its logic in this task.

- [ ] **Step 3: Write the OAuth start route**

```typescript
// apps/web/src/routes/api/auth/github.ts
import { createFileRoute } from '@tanstack/react-router'
import { SignJWT } from 'jose'

export const Route = createFileRoute('/api/auth/github')({
  server: {
    handlers: {
      GET: async () => {
        const clientId = process.env.GITHUB_CLIENT_ID
        const appUrl = process.env.APP_URL || 'http://localhost:3000'
        if (!clientId) {
          return new Response('OAuth not configured', { status: 500 })
        }

        const state = crypto.randomUUID()

        // The state cookie is signed, not merely present, per spec S7.
        const stateToken = await new SignJWT({ state })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('10m')
          .sign(new TextEncoder().encode(process.env.SESSION_SECRET!))

        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: `${appUrl}/api/auth/github/callback`,
          scope: 'read:user user:email',
          state,
        })

        const cookieParts = [
          `oauth_state=${stateToken}`,
          'HttpOnly',
          'SameSite=Lax',
          'Path=/',
          'Max-Age=600',
        ]
        if (process.env.NODE_ENV === 'production') cookieParts.push('Secure')

        return new Response(null, {
          status: 302,
          headers: {
            location: `https://github.com/login/oauth/authorize?${params}`,
            'set-cookie': cookieParts.join('; '),
          },
        })
      },
    },
  },
})
```

- [ ] **Step 4: Write the OAuth callback route**

Port `apps/api/src/routes/auth.ts:41-155` into `apps/web/src/routes/api/auth/github.callback.ts`, with these changes and no others:

- Read `oauth_state` with `readCookie`, verify it with `jwtVerify` pinned to `HS256`, and compare its `state` claim to the `state` query parameter. A missing or invalid cookie redirects to `${appUrl}/api/auth/github` exactly as the current code does at line 50.
- Replace `reply.setCookie('session', JSON.stringify({ userId: user.id }), ...)` with `buildSessionCookie(await signSession(user.id))`.
- Clear `oauth_state` with `buildClearCookie('oauth_state')`.
- Return `Response` objects with `location` and `set-cookie` headers rather than calling `reply.redirect`.
- Keep the `syncUserInstallations` call and the `hasActive` redirect branch exactly as they are.

- [ ] **Step 5: Write the `me` and `logout` routes**

```typescript
// apps/web/src/routes/api/auth/me.ts
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { db, userInstallations } from '@overlap/db'
import { eq } from 'drizzle-orm'
import { requireUser } from '../../../lib/auth'

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const user = await requireUser(request)
          const insts = await db.query.userInstallations.findMany({
            where: eq(userInstallations.userId, user.id),
            with: { installation: true },
          })
          return json({
            user,
            hasInstallations: insts.some(
              (ui) => ui.installation.status === 'active'
            ),
          })
        } catch (res) {
          if (res instanceof Response) return res
          throw res
        }
      },
    },
  },
})
```

```typescript
// apps/web/src/routes/api/auth/logout.ts
import { createFileRoute } from '@tanstack/react-router'
import { buildClearCookie } from '../../../lib/auth'
import { SESSION_COOKIE_NAME } from '../../../lib/session'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async () => {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': buildClearCookie(SESSION_COOKIE_NAME),
          },
        })
      },
    },
  },
})
```

- [ ] **Step 6: Verify typecheck and build**

Run: `pnpm --filter @overlap/web typecheck && pnpm --filter @overlap/web build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/api apps/web/src/lib/github-oauth.ts
git commit -m "feat(web): port health and auth routes to server routes"
```

---

### Task 7: Repositories and push server routes

**Files:**
- Create: `apps/web/src/routes/api/repositories.ts`
- Create: `apps/web/src/routes/api/repositories.$id.ts`
- Create: `apps/web/src/routes/api/push.ts`
- Create: `apps/web/src/lib/repo-access.ts`
- Reference: `apps/api/src/routes/repositories.ts`, `apps/api/src/routes/push.ts`

**Interfaces:**
- Consumes: `requireUser` from Task 5
- Produces: `requireRepoAccess(user: AuthUser, repoId: string): Promise<Repository>` which throws a `Response` with status 403 or 404

The spec's "verified clean" note records that `requireRepoAccess` is the control preventing insecure direct object references. It is carried across with its logic unchanged. Every `:id` route must call it before reading or writing, matching `apps/api/src/routes/repositories.ts:101` and every other handler in that file.

- [ ] **Step 1: Port `requireRepoAccess`**

Copy the `requireRepoAccess` helper from `apps/api/src/routes/repositories.ts` into `apps/web/src/lib/repo-access.ts`. Change its signature from `(request, reply, id)` to `(user: AuthUser, repoId: string)`, and change its failure paths from `reply.status(...).send(...)` to `throw new Response(...)`. The access-checking logic itself is unchanged.

- [ ] **Step 2: Port every repositories handler**

Port all nine handlers from `apps/api/src/routes/repositories.ts` into the two route files, splitting by path shape. Each handler:

- calls `await requireUser(request)` first
- calls `await requireRepoAccess(user, id)` before any data access, for every route with an `:id` parameter
- keeps its existing Zod parsing (`repositoryIdParamSchema`, `repositorySettingsUpdateSchema`, and the querystring schemas) exactly as-is
- returns `json(...)` instead of returning a bare object

- [ ] **Step 3: Port the push routes**

Port `apps/api/src/routes/push.ts` in full. Keep `ALLOWED_PUSH_HOSTS` and `isAllowedPushEndpoint` byte-for-byte; that allowlist is the control preventing the push endpoint from being pointed at arbitrary hosts.

Add the per-user subscription cap required by spec S3, before the insert:

```typescript
const MAX_SUBSCRIPTIONS_PER_USER = 20

const existing = await db.query.pushSubscriptions.findMany({
  where: eq(pushSubscriptions.userId, user.id),
})

const isKnownEndpoint = existing.some((s) => s.endpoint === endpoint)

if (!isKnownEndpoint && existing.length >= MAX_SUBSCRIPTIONS_PER_USER) {
  return json({ error: 'Subscription limit reached' }, { status: 429 })
}
```

- [ ] **Step 4: Verify typecheck and build**

Run: `pnpm --filter @overlap/web typecheck && pnpm --filter @overlap/web build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/api apps/web/src/lib/repo-access.ts
git commit -m "feat(web): port repositories and push routes to server routes"
```

---

## Phase 3: Workflows

### Task 8: Workflow steps

**Files:**
- Create: `apps/web/src/workflows/steps.ts`
- Create: `apps/web/src/workflows/errors.ts`
- Create: `apps/web/src/workflows/__tests__/errors.test.ts`
- Reference: all six files in `apps/worker/src/processors/`

**Interfaces:**
- Consumes: `@overlap/db`, `@overlap/github`, `@overlap/shared`
- Produces, all as `"use step"` functions:
  - `loadEvent(deliveryId: string): Promise<LoadedEvent>`
  - `upsertBranch(deliveryId: string): Promise<{ branchId: string; repositoryId: string; installationId: number; branchName: string; sha: string; isDefault: boolean } | null>`
  - `syncBranchFiles(input: { repositoryId: string; branchName: string; sha: string; installationId: number }): Promise<{ filesIndexed: number }>`
  - `detectOverlaps(input: { repositoryId: string; branchId: string }): Promise<{ overlapsFound: number; notifications: NotificationTarget[] }>`
  - `postCheckRun(input: { repositoryId: string; pullRequestId: string; overlapId: string }): Promise<{ checkRunId: number | null }>`
  - `sendPush(input: { repositoryId: string; overlapId: string; targetBranchId: string }): Promise<{ sent: number }>`
  - `upsertPullRequest(deliveryId: string): Promise<{ repositoryId: string; branchId: string } | null>`
  - `syncInstallation(deliveryId: string): Promise<{ repositoryIds: string[] }>`
  - `syncRepository(repositoryId: string): Promise<{ added: number; updated: number; markedForDeletion: number }>`
  - `pruneStaleBranches(repositoryId?: string): Promise<{ prunedBranches: number }>`
  - `cleanupOldEvents(): Promise<{ cleaned: boolean }>`
  - `type NotificationTarget = { repositoryId: string; overlapId: string; targetBranchId: string; pullRequestIds: string[] }`

Each function is the body of the corresponding processor with three changes: the `Job<T>` parameter becomes plain arguments, all `queue.add(...)` calls are deleted because the workflow now sequences the work, and error handling follows the mapping below.

- [ ] **Step 1: Write the failing tests for the error mapping**

Steps without the compiler treat `"use step"` as a no-op, so they can be tested as plain functions. Test the error classifier in isolation.

```typescript
// apps/web/src/workflows/__tests__/errors.test.ts
import { describe, it, expect } from 'vitest'
import { FatalError, RetryableError } from 'workflow'
import { classifyGitHubError } from '../errors'

describe('classifyGitHubError', () => {
  it('maps 429 to RetryableError honoring Retry-After', () => {
    const err = classifyGitHubError({
      status: 429,
      message: 'rate limited',
      response: { headers: { 'retry-after': '120' } },
    })
    expect(err).toBeInstanceOf(RetryableError)
    expect((err as RetryableError).retryAfter).toBe('120s')
  })

  it('maps 403 to RetryableError', () => {
    const err = classifyGitHubError({ status: 403, message: 'forbidden' })
    expect(err).toBeInstanceOf(RetryableError)
  })

  it('defaults Retry-After to 5m when the header is absent', () => {
    const err = classifyGitHubError({ status: 429, message: 'rate limited' })
    expect((err as RetryableError).retryAfter).toBe('5m')
  })

  it('maps 500 to RetryableError', () => {
    expect(classifyGitHubError({ status: 500, message: 'boom' })).toBeInstanceOf(
      RetryableError
    )
  })

  it('maps 404 to FatalError', () => {
    expect(classifyGitHubError({ status: 404, message: 'gone' })).toBeInstanceOf(
      FatalError
    )
  })

  it('maps 422 to FatalError', () => {
    expect(
      classifyGitHubError({ status: 422, message: 'unprocessable' })
    ).toBeInstanceOf(FatalError)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @overlap/web test`
Expected: FAIL, cannot resolve `../errors`.

- [ ] **Step 3: Implement the classifier**

```typescript
// apps/web/src/workflows/errors.ts
import { FatalError, RetryableError } from 'workflow'

type GitHubErrorLike = {
  status?: number
  message?: string
  response?: { headers?: Record<string, string | undefined> }
}

export function classifyGitHubError(err: GitHubErrorLike): Error {
  const status = err.status
  const message = err.message ?? 'GitHub request failed'

  if (status === 429 || status === 403) {
    const header = err.response?.headers?.['retry-after']
    const retryAfter = header ? `${header}s` : '5m'
    return new RetryableError(`GitHub rate limited: ${message}`, { retryAfter })
  }

  if (status !== undefined && status >= 400 && status < 500) {
    return new FatalError(message)
  }

  // 5xx, network failures and unknown shapes are transient.
  return new RetryableError(message, { retryAfter: '30s' })
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @overlap/web test`
Expected: PASS.

- [ ] **Step 5: Port the processors into steps**

Port each processor. Two specific corrections are mandatory and are the reason this task exists rather than a straight copy:

**`syncBranchFiles`.** `apps/worker/src/processors/branch-sync.ts:52-56` currently catches the GitHub failure and assigns `changedFiles = []`, after which the code unconditionally deletes every `branchFiles` row for the branch. That wipes the file index on any transient failure, and the next detection run then marks genuine overlaps `resolved`. Replace the catch with:

```typescript
try {
  changedFiles = await github.getBranchFiles(
    installationId, owner, repoName, branchName, repo.defaultBranch
  )
} catch (error) {
  throw classifyGitHubError(error as never)
}
```

The delete must not be reachable when the fetch failed.

**`postCheckRun`.** `apps/worker/src/processors/github-feedback.ts:110-113` swallows `createCheckRun` failures. Replace with `throw classifyGitHubError(error as never)`. The check-run duplication issue is handled separately in Task 9.

Delete every `Queue`, `Redis` and `queue.add(...)` reference. `detectOverlaps` returns its notification targets to the caller instead of enqueuing them, which is what the `NotificationTarget[]` return type is for.

- [ ] **Step 6: Verify typecheck**

Run: `pnpm --filter @overlap/web typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/workflows
git commit -m "feat(web): port worker processors to workflow steps

Fixes two swallowed-error paths carried over from the BullMQ processors:
branch-sync no longer wipes a branch file index on transient GitHub
failure, and check-run creation failures no longer pass silently."
```

---

### Task 9: Check run idempotency

**Files:**
- Modify: `packages/github/src/client.ts`
- Modify: `apps/web/src/workflows/steps.ts`

**Interfaces:**
- Consumes: `postCheckRun` from Task 8
- Produces: `updateCheckRun(installationId: number, owner: string, repo: string, checkRunId: number, conclusion: string, title: string, summary: string): Promise<number>` on the GitHub client

A step that calls `createCheckRun` successfully and then fails before returning will retry and create a second check run, because GitHub's API accepts no idempotency key and a repeat call creates a new record rather than updating. `apps/web/node_modules/workflow/docs/foundations/idempotency.mdx` describes this failure mode directly.

- [ ] **Step 1: Add `updateCheckRun` to the client**

Add a method alongside `createCheckRun` at `packages/github/src/client.ts:345` that calls `octokit.rest.checks.update` with the same argument shape, taking `check_run_id` instead of `head_sha`.

- [ ] **Step 2: Remove the internal retry wrapper**

Delete the `withRetry` helper at `packages/github/src/client.ts:15` and unwrap every call site. WDK owns retry policy now; an inner retry loop burns the step's wall-clock budget and hides the rate-limit signal that `classifyGitHubError` needs to see.

- [ ] **Step 3: Make `postCheckRun` update rather than duplicate**

In `postCheckRun`, look up the existing `pr_alerts` row first. If it has a `checkRunId`, call `updateCheckRun`. Only call `createCheckRun` when no check run has been recorded, and write the resulting id to `pr_alerts` immediately.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors across the workspace.

- [ ] **Step 5: Commit**

```bash
git add packages/github/src/client.ts apps/web/src/workflows/steps.ts
git commit -m "fix(github): make check run posting idempotent under step retry"
```

---

### Task 10: The workflow

**Files:**
- Create: `apps/web/src/workflows/process-webhook.ts`
- Create: `apps/web/src/workflows/maintenance.ts`

**Interfaces:**
- Consumes: every step from Task 8
- Produces:
  - `processWebhook(deliveryId: string): Promise<{ handled: boolean }>`
  - `pruneBranchesWorkflow(): Promise<{ prunedBranches: number }>`
  - `cleanupEventsWorkflow(): Promise<{ cleaned: boolean }>`
  - `syncRepositoryWorkflow(repositoryId: string): Promise<void>`

- [ ] **Step 1: Write the workflow**

```typescript
// apps/web/src/workflows/process-webhook.ts
import {
  loadEvent,
  upsertBranch,
  upsertPullRequest,
  syncInstallation,
  syncBranchFiles,
  detectOverlaps,
  postCheckRun,
  sendPush,
  syncRepository,
} from './steps'

export async function processWebhook(deliveryId: string) {
  'use workflow'

  const evt = await loadEvent(deliveryId)

  if (evt.type === 'push') {
    const branch = await upsertBranch(deliveryId)
    if (!branch) return { handled: false }

    await syncBranchFiles({
      repositoryId: branch.repositoryId,
      branchName: branch.branchName,
      sha: branch.sha,
      installationId: branch.installationId,
    })

    if (branch.isDefault) return { handled: true }

    const result = await detectOverlaps({
      repositoryId: branch.repositoryId,
      branchId: branch.branchId,
    })

    for (const n of result.notifications) {
      for (const pullRequestId of n.pullRequestIds) {
        await postCheckRun({
          repositoryId: n.repositoryId,
          pullRequestId,
          overlapId: n.overlapId,
        })
      }
      await sendPush({
        repositoryId: n.repositoryId,
        overlapId: n.overlapId,
        targetBranchId: n.targetBranchId,
      })
    }

    return { handled: true }
  }

  if (evt.type === 'pull_request') {
    const pr = await upsertPullRequest(deliveryId)
    if (!pr) return { handled: false }

    const result = await detectOverlaps({
      repositoryId: pr.repositoryId,
      branchId: pr.branchId,
    })

    for (const n of result.notifications) {
      for (const pullRequestId of n.pullRequestIds) {
        await postCheckRun({
          repositoryId: n.repositoryId,
          pullRequestId,
          overlapId: n.overlapId,
        })
      }
      await sendPush({
        repositoryId: n.repositoryId,
        overlapId: n.overlapId,
        targetBranchId: n.targetBranchId,
      })
    }

    return { handled: true }
  }

  if (evt.type === 'installation') {
    const { repositoryIds } = await syncInstallation(deliveryId)
    for (const repositoryId of repositoryIds) {
      await syncRepository(repositoryId)
    }
    return { handled: true }
  }

  return { handled: false }
}
```

The `await syncBranchFiles(...)` followed by `await detectOverlaps(...)` is the entire point of this migration. It replaces the `delay: 5000` at `apps/worker/src/processors/webhook-events.ts:150`, which was a hope that one queue would finish before another started. Do not reintroduce a delay anywhere in this file.

- [ ] **Step 2: Write the maintenance workflows**

```typescript
// apps/web/src/workflows/maintenance.ts
import { pruneStaleBranches, cleanupOldEvents, syncRepository } from './steps'

export async function pruneBranchesWorkflow() {
  'use workflow'
  return await pruneStaleBranches()
}

export async function cleanupEventsWorkflow() {
  'use workflow'
  return await cleanupOldEvents()
}

export async function syncRepositoryWorkflow(repositoryId: string) {
  'use workflow'
  await syncRepository(repositoryId)
}
```

- [ ] **Step 3: Verify the build compiles the directives**

Run: `pnpm --filter @overlap/web build`
Expected: build succeeds. A failure mentioning directives means the `workflow()` plugin ordering in Task 2 is wrong.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/workflows
git commit -m "feat(web): add durable webhook and maintenance workflows

Replaces the 5s delay between branch sync and overlap detection with a
real happens-before edge."
```

---

### Task 11: Webhook route

**Files:**
- Create: `apps/web/src/routes/api/webhooks/github.ts`
- Create: `apps/web/src/routes/api/webhooks/__tests__/verify-order.test.ts`
- Reference: `apps/api/src/routes/webhooks.ts`

**Interfaces:**
- Consumes: `processWebhook` from Task 10, `verifyWebhookSignature` from `@overlap/github`
- Produces: `POST /api/webhooks/github`

Spec S2 makes the ordering here a security requirement. Signature verification of the raw body precedes every database write and every workflow start.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/routes/api/webhooks/__tests__/verify-order.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleWebhook } from '../github-handler'

const inserts = vi.fn()
const starts = vi.fn()

vi.mock('@overlap/db', () => ({
  db: { insert: () => ({ values: inserts }) },
}))

beforeEach(() => {
  inserts.mockReset()
  starts.mockReset()
  process.env.GITHUB_WEBHOOK_SECRET = 'test-secret'
})

describe('handleWebhook', () => {
  it('rejects an invalid signature with 401', async () => {
    const req = new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'abc-123',
        'x-hub-signature-256': 'sha256=deadbeef',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    })

    const res = await handleWebhook(req, { start: starts })
    expect(res.status).toBe(401)
  })

  it('writes nothing to the database when the signature is invalid', async () => {
    const req = new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'abc-123',
        'x-hub-signature-256': 'sha256=deadbeef',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    })

    await handleWebhook(req, { start: starts })
    expect(inserts).not.toHaveBeenCalled()
  })

  it('starts no workflow when the signature is invalid', async () => {
    const req = new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'abc-123',
        'x-hub-signature-256': 'sha256=deadbeef',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    })

    await handleWebhook(req, { start: starts })
    expect(starts).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @overlap/web test`
Expected: FAIL, cannot resolve `../github-handler`.

- [ ] **Step 3: Implement the handler**

Extract the logic into `apps/web/src/routes/api/webhooks/github-handler.ts` so it is testable without the route wrapper. It takes the `start` function as an injected dependency, which is what makes the test above possible.

```typescript
// apps/web/src/routes/api/webhooks/github-handler.ts
import { verifyWebhookSignature } from '@overlap/github'
import { db, webhookEvents, repositories } from '@overlap/db'
import { eq } from 'drizzle-orm'
import { processWebhook } from '../../../workflows/process-webhook'

type Deps = { start: (wf: unknown, args: unknown[]) => Promise<unknown> }

export async function handleWebhook(
  request: Request,
  deps: Deps
): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
    })
  }

  // Raw bytes, before any parsing. This is what GitHub signed.
  const raw = await request.text()
  const signature = request.headers.get('x-hub-signature-256') ?? ''
  const eventType = request.headers.get('x-github-event') ?? ''
  const deliveryId = request.headers.get('x-github-delivery') ?? ''

  // Nothing below this line may execute for an unverified request.
  const verification = verifyWebhookSignature(raw, signature, secret)
  if (!verification.valid) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
    })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
    })
  }

  let repositoryId: string | null = null
  const repoData = payload.repository as { id?: number } | undefined
  if (repoData?.id) {
    const repo = await db.query.repositories.findFirst({
      where: eq(repositories.githubId, repoData.id),
    })
    repositoryId = repo?.id ?? null
  }

  const [row] = await db
    .insert(webhookEvents)
    .values({ eventType, deliveryId, repositoryId, payload })
    .onConflictDoNothing()
    .returning()

  // No row means GitHub redelivered a delivery we already accepted.
  if (!row) {
    return new Response(JSON.stringify({ received: true }), { status: 200 })
  }

  await deps.start(processWebhook, [deliveryId])

  return new Response(JSON.stringify({ received: true }), { status: 200 })
}
```

- [ ] **Step 4: Write the thin route wrapper**

```typescript
// apps/web/src/routes/api/webhooks/github.ts
import { createFileRoute } from '@tanstack/react-router'
import { start } from 'workflow/api'
import { handleWebhook } from './github-handler'

export const Route = createFileRoute('/api/webhooks/github')({
  server: {
    handlers: {
      POST: async ({ request }) => handleWebhook(request, { start }),
    },
  },
})
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `pnpm --filter @overlap/web test`
Expected: PASS, all three ordering tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/api/webhooks
git commit -m "feat(web): port GitHub webhook route with verify-before-write ordering

Deduplication moves from BullMQ jobId to the webhook_events.deliveryId
unique constraint, which is durable rather than TTL-bound."
```

---

### Task 12: Cron routes

**Files:**
- Create: `apps/web/src/routes/api/cron/prune-branches.ts`
- Create: `apps/web/src/routes/api/cron/cleanup-events.ts`
- Create: `apps/web/src/lib/cron-auth.ts`
- Create: `apps/web/src/lib/__tests__/cron-auth.test.ts`
- Create: `vercel.json`

**Interfaces:**
- Consumes: `pruneBranchesWorkflow`, `cleanupEventsWorkflow` from Task 10
- Produces: `isAuthorizedCron(request: Request): boolean`

Spec S6 requires a timing-safe comparison. These endpoints are publicly routable and start workflows that iterate every active repository.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/lib/__tests__/cron-auth.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { isAuthorizedCron } from '../cron-auth'

beforeEach(() => {
  process.env.CRON_SECRET = 'correct-secret'
})

function req(auth?: string): Request {
  return new Request('https://example.com/api/cron/prune-branches', {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('isAuthorizedCron', () => {
  it('accepts the correct bearer token', () => {
    expect(isAuthorizedCron(req('Bearer correct-secret'))).toBe(true)
  })

  it('rejects a wrong token of the same length', () => {
    expect(isAuthorizedCron(req('Bearer wrongxxsecret!'))).toBe(false)
  })

  it('rejects a wrong token of a different length', () => {
    expect(isAuthorizedCron(req('Bearer short'))).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(isAuthorizedCron(req())).toBe(false)
  })

  it('rejects when CRON_SECRET is unset', () => {
    delete process.env.CRON_SECRET
    expect(isAuthorizedCron(req('Bearer anything'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @overlap/web test`
Expected: FAIL, cannot resolve `../cron-auth`.

- [ ] **Step 3: Implement the check**

```typescript
// apps/web/src/lib/cron-auth.ts
import { timingSafeEqual } from 'node:crypto'

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false

  const provided = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(secret)

  // timingSafeEqual throws on length mismatch, so compare lengths first.
  // The length itself is not secret; the contents are.
  if (provided.length !== expected.length) return false

  return timingSafeEqual(provided, expected)
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @overlap/web test`
Expected: PASS, 5 cron auth tests.

- [ ] **Step 5: Write the two cron routes**

Each route checks `isAuthorizedCron(request)`, returns 401 when it fails, and otherwise calls `start(...)` on its workflow and returns 200 immediately.

- [ ] **Step 6: Write `vercel.json`**

```json
{
  "crons": [
    { "path": "/api/cron/prune-branches", "schedule": "0 */6 * * *" },
    { "path": "/api/cron/cleanup-events", "schedule": "0 3 * * *" }
  ]
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/api/cron apps/web/src/lib/cron-auth.ts apps/web/src/lib/__tests__/cron-auth.test.ts vercel.json
git commit -m "feat: replace BullMQ job scheduler with Vercel Cron"
```

---

## Phase 4: Teardown

### Task 13: Delete the old apps and dependencies

**Files:**
- Delete: `apps/api/`, `apps/worker/`
- Delete: `railway.json`, `apps/web/Dockerfile`
- Modify: `docker-compose.yml`, `packages/shared/src/constants/index.ts`

**Interfaces:**
- Consumes: everything above
- Produces: a workspace with one deployable app

Do this only after Tasks 1 through 12 are green. Until then the old code is the reference for the port.

No frontend changes are required. `VITE_API_URL` appears nowhere in `apps/web/src`; it existed only as a dev proxy target in `vite.config.ts`, which Task 2 already removed. The React code already fetches relative paths such as `/api/repositories`, which now resolve to the folded-in server routes on the same origin.

- [ ] **Step 1: Confirm nothing still imports the deleted packages**

Run: `grep -rn "bullmq\|ioredis\|REDIS_URL\|VITE_API_URL\|API_URL" apps/web/src packages/ --include=*.ts --include=*.tsx`
Expected: no results. Fix any that appear before continuing.

- [ ] **Step 2: Delete the directories and files**

```bash
git rm -r apps/api apps/worker
git rm railway.json apps/web/Dockerfile
```

- [ ] **Step 3: Remove `QUEUE_NAMES` and `RATE_LIMITS`**

Delete both exports from `packages/shared/src/constants/index.ts:11-27`. Keep `DEFAULT_SETTINGS` and everything below it.

- [ ] **Step 4: Remove the Redis service from `docker-compose.yml`**

- [ ] **Step 5: Verify the whole workspace builds and tests clean**

Run: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass. This is the gate for the whole migration.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Railway apps, BullMQ and Redis

apps/api and apps/worker are now served by apps/web. Redis had exactly
one consumer (BullMQ) and is deleted with it."
```

---

### Task 14: Supabase project and Data API hardening

This task is operational rather than code. It must complete before any deployment is pointed at the new database.

**Interfaces:**
- Consumes: nothing
- Produces: `DATABASE_URL`, `DIRECT_URL` for the Vercel environment

- [ ] **Step 1: Create the Supabase project**

- [ ] **Step 2: Disable the Data API for the `public` schema**

Spec S1. Railway Postgres had no HTTP surface. Supabase exposes PostgREST at `/rest/v1` publicly, and the restored schema has no row-level security, so every table would be readable by any holder of the anon key. Disable the Data API in project settings before the application writes anything.

- [ ] **Step 3: Verify from outside the network**

```bash
curl -s "https://<project>.supabase.co/rest/v1/users?select=*" \
  -H "apikey: <anon-key>" | head
```

Expected: an error or empty result, never row data. If rows come back, stop and fix before continuing.

- [ ] **Step 4: Create the schema**

Run: `DIRECT_URL=<direct-connection> pnpm db:migrate`
Expected: tables created. Restore no data, per the spec's Database section.

- [ ] **Step 5: Record `repository_settings` from Railway**

Check whether `pruningDays` or `ignoredPaths` differ from the defaults in `packages/shared/src/constants/index.ts`. If so, note them for manual re-entry after cutover.

---

### Task 15: Deploy and cut over

- [ ] **Step 1: Create the Vercel project and set environment variables**

Set every variable from the spec's environment table. Generate a new `SESSION_SECRET` rather than reusing the Railway value, per spec S5.

- [ ] **Step 2: Deploy a preview**

Run: `vercel deploy`

- [ ] **Step 3: Add Vercel Firewall rate limit rules**

Spec S3. Rules on `/api/webhooks/github` and `/api/auth/*`. On Vercel, a request flood is a billed invocation rather than wasted CPU, which is the inverse of the Railway situation.

- [ ] **Step 4: Point a second GitHub App at the preview URL and verify end to end**

Install on a throwaway repository. Push a commit. Open a pull request. Confirm the check run appears and the push notification arrives. Inspect the runs with `npx workflow inspect runs --backend vercel --project <project> --team crod`.

- [ ] **Step 5: Flip the production GitHub App webhook and OAuth callback URLs**

- [ ] **Step 6: Sign in, reinstall the App, and verify the rebuild**

Confirm the pipeline reconstructs the same branches and overlaps that Railway is still serving. This comparison is the acceptance test for the entire migration.

- [ ] **Step 7: Re-enter `repository_settings` and re-enable browser notifications**

- [ ] **Step 8: Tear down the Railway project**
