import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * `params.overlapId` used to be read raw, while `params.id` always went
 * through `repositoryIdParamSchema`. A non-UUID `overlapId` (e.g. a stray
 * path segment, or a caller poking at the URL) reached the Drizzle query
 * unvalidated, and Postgres rejected it with `22P02` ("invalid input syntax
 * for type uuid"). That error escaped the route's `catch (res)` block -
 * which only special-cases `res instanceof Response` - as an unhandled 500
 * instead of the 404 a bad id should produce. These tests pin the fix: a
 * non-UUID `overlapId` now returns 404, the same as a well-formed id that
 * simply does not exist, and never reaches the database.
 */

const findFirst = vi.fn()
const updateSet = vi.fn()
const requireUser = vi.fn()
const requireRepoAccess = vi.fn()

vi.mock('@overlap/db', () => ({
  db: {
    query: {
      overlaps: { findFirst: (...args: unknown[]) => findFirst(...args) },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSet(values)
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: 'overlap-1', ...values }]),
          }),
        }
      },
    }),
  },
  overlaps: { id: 'id', repositoryId: 'repositoryId', sourceBranchId: 'sourceBranchId', targetBranchId: 'targetBranchId' },
}))

vi.mock('../../../lib/auth', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}))

vi.mock('../../../lib/repo-access', () => ({
  requireRepoAccess: (...args: unknown[]) => requireRepoAccess(...args),
}))

const { Route } = await import('../repositories.$id.overlaps.$overlapId')

// TanStack Start's generic `RouteApi` type does not preserve the literal
// handler map shape once read back off `Route.options.server.handlers`, even
// though the object is exactly what the route file passed to
// `createFileRoute(...)`. This is a test-only escape hatch to call the PATCH
// handler directly, the same way it is invoked at runtime.
type PatchHandler = (ctx: {
  request: Request
  params: Record<string, string>
}) => Promise<Response>

const patch = (Route.options.server?.handlers as unknown as { PATCH: PatchHandler }).PATCH

const REPO_ID = '11111111-1111-1111-1111-111111111111'
const OVERLAP_ID = '22222222-2222-2222-2222-222222222222'

function patchRequest(status: 'resolved' | 'active' | 'ignored' = 'resolved') {
  return new Request(`https://example.com/api/repositories/${REPO_ID}/overlaps/x`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

describe('PATCH /api/repositories/$id/overlaps/$overlapId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUser.mockResolvedValue({ id: 'user-1' })
    requireRepoAccess.mockResolvedValue({ id: REPO_ID })
  })

  it('returns 404 for a non-UUID overlapId instead of a 500', async () => {
    const res = await patch({
      request: patchRequest(),
      params: { id: REPO_ID, overlapId: 'not-a-uuid' },
    })

    expect(res.status).toBe(404)
    // The malformed id must never reach the database.
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('returns 404 for a well-formed but nonexistent overlapId', async () => {
    findFirst.mockResolvedValue(undefined)

    const res = await patch({
      request: patchRequest(),
      params: { id: REPO_ID, overlapId: OVERLAP_ID },
    })

    expect(res.status).toBe(404)
  })

  it('updates the overlap for a well-formed, existing overlapId', async () => {
    findFirst.mockResolvedValue({ id: OVERLAP_ID, repositoryId: REPO_ID })

    const res = await patch({
      request: patchRequest('resolved'),
      params: { id: REPO_ID, overlapId: OVERLAP_ID },
    })

    expect(res.status).toBe(200)
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'resolved', resolvedAt: expect.any(Date) })
    )
  })
})
