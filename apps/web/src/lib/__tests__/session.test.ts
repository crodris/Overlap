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
