import { timingSafeEqual } from 'node:crypto'

/**
 * Authorizes a Vercel Cron request.
 *
 * Cron endpoints are publicly routable, and the ones that use this guard
 * kick off workflows that iterate every active repository, so a forged
 * request amplifies both cost and database load. The comparison uses
 * `timingSafeEqual` rather than `===` because `===` short-circuits on the
 * first differing byte, leaking the secret through response timing.
 *
 * `timingSafeEqual` throws on a length mismatch, so lengths are compared
 * first. The length itself is not secret; only the contents are.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false

  const provided = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(secret)

  if (provided.length !== expected.length) return false

  return timingSafeEqual(provided, expected)
}
