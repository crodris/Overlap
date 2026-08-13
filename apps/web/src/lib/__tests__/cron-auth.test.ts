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

  it('rejects a lowercase "bearer" prefix', () => {
    expect(isAuthorizedCron(req('bearer correct-secret'))).toBe(false)
  })

  it('rejects a header with no space after Bearer', () => {
    expect(isAuthorizedCron(req('Bearercorrect-secret'))).toBe(false)
  })

  it('rejects an empty token after the Bearer prefix', () => {
    expect(isAuthorizedCron(req('Bearer '))).toBe(false)
  })

  it('rejects extra whitespace between the prefix and the token', () => {
    // Leading/trailing whitespace on the header value is trimmed by the
    // Fetch Headers implementation, but internal whitespace survives, so
    // a double space here still reaches isAuthorizedCron and must fail.
    expect(isAuthorizedCron(req('Bearer  correct-secret'))).toBe(false)
  })

  it('rejects a completely unrelated auth scheme', () => {
    expect(isAuthorizedCron(req('Basic correct-secret'))).toBe(false)
  })
})
