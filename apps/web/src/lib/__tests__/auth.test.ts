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
