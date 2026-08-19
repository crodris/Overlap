import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SignJWT } from 'jose'

/**
 * The sign-up allowlist can only be exercised end-to-end with a GitHub account
 * that is NOT on it, which the maintainer does not have - and an already
 * registered account cannot tell a working gate from a broken one, because the
 * `github_id` lookup lets it through either way. These tests stand in for that
 * missing account: they drive the real OAuth callback handler and pin the three
 * outcomes that matter.
 *
 * The state cookie is a genuine signed JWT rather than a stub, so the CSRF
 * check runs for real instead of being mocked away.
 */

const SESSION_SECRET = 'test-secret-value-at-least-32-bytes-long'
const APP_URL = 'https://overlap.test'

// `appUrl` is read at module scope in the route, so it has to be set before
// the dynamic import below.
process.env.SESSION_SECRET = SESSION_SECRET
process.env.APP_URL = APP_URL

const findFirstUser = vi.fn()
const findManyInstallations = vi.fn()
const insertValues = vi.fn()
const syncUserInstallations = vi.fn()

vi.mock('@overlap/db', () => ({
  db: {
    query: {
      users: { findFirst: (...args: unknown[]) => findFirstUser(...args) },
      userInstallations: {
        findMany: (...args: unknown[]) => findManyInstallations(...args),
      },
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertValues(v)
        return {
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([{ id: 'user-1', ...v }]),
          }),
        }
      },
    }),
  },
  users: { githubId: 'githubId' },
  userInstallations: { userId: 'userId' },
}))

vi.mock('../../../../lib/github-oauth', () => ({
  syncUserInstallations: (...args: unknown[]) => syncUserInstallations(...args),
}))

const { Route } = await import('../github.callback')

// Same test-only escape hatch used by the other route handler tests: the
// generic RouteApi type does not preserve the literal handler map shape.
type GetHandler = (ctx: { request: Request }) => Promise<Response>
const get = (Route.options.server?.handlers as unknown as { GET: GetHandler }).GET

const STATE = 'state-value-123'

async function stateCookie(state = STATE): Promise<string> {
  return new SignJWT({ state })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(SESSION_SECRET))
}

async function callbackRequest(state = STATE): Promise<Request> {
  return new Request(
    `${APP_URL}/api/auth/github/callback?code=oauth-code&state=${state}`,
    { headers: { cookie: `oauth_state=${await stateCookie(state)}` } }
  )
}

/** Stubs GitHub's token exchange and profile endpoints. */
function mockGitHub(login: string, githubId = 4242) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('login/oauth/access_token')) {
        return new Response(JSON.stringify({ access_token: 'gh-token' }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('api.github.com/user')) {
        return new Response(
          JSON.stringify({
            id: githubId,
            login,
            email: `${login}@example.com`,
            avatar_url: 'https://avatars.example/x.png',
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  )
}

function sessionCookies(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((c) => c.startsWith('session='))
}

describe('GET /api/auth/github/callback - sign-up allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findManyInstallations.mockResolvedValue([])
    process.env.ALLOWED_GITHUB_USERS = 'crodris'
    delete process.env.NODE_ENV
  })

  it('turns away a new user who is not on the allowlist, without touching the database', async () => {
    findFirstUser.mockResolvedValue(undefined)
    mockGitHub('random-stranger')

    const res = await get({ request: await callbackRequest() })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/login?error=signups_closed`)
    // The whole point: no row is ever written for a rejected sign-up.
    expect(insertValues).not.toHaveBeenCalled()
    // And they must not walk away holding a session.
    expect(sessionCookies(res)).toHaveLength(0)
  })

  it('lets a new user on the allowlist through and creates their row', async () => {
    findFirstUser.mockResolvedValue(undefined)
    mockGitHub('crodris')

    const res = await get({ request: await callbackRequest() })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).not.toContain('signups_closed')
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'crodris', githubId: 4242 })
    )
    expect(sessionCookies(res)).toHaveLength(1)
  })

  it('lets an existing user in even when they are absent from the allowlist', async () => {
    // The guarantee that editing ALLOWED_GITHUB_USERS cannot lock out anyone
    // who already has an account.
    findFirstUser.mockResolvedValue({ id: 'user-1', githubId: 4242 })
    mockGitHub('someone-removed-from-the-list')

    const res = await get({ request: await callbackRequest() })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).not.toContain('signups_closed')
    expect(insertValues).toHaveBeenCalled()
    expect(sessionCookies(res)).toHaveLength(1)
  })

  it('matches the allowlist case-insensitively for a new user', async () => {
    findFirstUser.mockResolvedValue(undefined)
    process.env.ALLOWED_GITHUB_USERS = 'CroDris'
    mockGitHub('crodris')

    const res = await get({ request: await callbackRequest() })

    expect(res.headers.get('location')).not.toContain('signups_closed')
    expect(insertValues).toHaveBeenCalled()
  })

  it('rejects every new sign-up in production when no allowlist is configured', async () => {
    findFirstUser.mockResolvedValue(undefined)
    delete process.env.ALLOWED_GITHUB_USERS
    process.env.NODE_ENV = 'production'
    mockGitHub('crodris')

    const res = await get({ request: await callbackRequest() })

    expect(res.headers.get('location')).toBe(`${APP_URL}/login?error=signups_closed`)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('rejects a forged state cookie before reaching the allowlist or GitHub', async () => {
    findFirstUser.mockResolvedValue(undefined)
    mockGitHub('random-stranger')

    const forged = await new SignJWT({ state: STATE })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('a-different-secret-that-is-32-bytes!!'))

    const res = await get({
      request: new Request(
        `${APP_URL}/api/auth/github/callback?code=oauth-code&state=${STATE}`,
        { headers: { cookie: `oauth_state=${forged}` } }
      ),
    })

    expect(res.status).toBe(400)
    expect(insertValues).not.toHaveBeenCalled()
  })
})
