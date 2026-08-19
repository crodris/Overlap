import { describe, it, expect, afterEach } from 'vitest'
import { isSignupAllowed } from '../signup-gate'

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  delete process.env.ALLOWED_GITHUB_USERS
  process.env.NODE_ENV = originalNodeEnv
})

describe('isSignupAllowed', () => {
  it('allows a login present in the allowlist', () => {
    process.env.ALLOWED_GITHUB_USERS = 'crod951,octocat'
    expect(isSignupAllowed('octocat')).toBe(true)
  })

  it('rejects a login absent from the allowlist', () => {
    process.env.ALLOWED_GITHUB_USERS = 'crod951,octocat'
    expect(isSignupAllowed('random-spammer')).toBe(false)
  })

  it('matches case-insensitively, since GitHub logins are', () => {
    process.env.ALLOWED_GITHUB_USERS = 'CroD951'
    expect(isSignupAllowed('crod951')).toBe(true)
  })

  it('tolerates whitespace around entries', () => {
    process.env.ALLOWED_GITHUB_USERS = ' crod951 , octocat '
    expect(isSignupAllowed('crod951')).toBe(true)
    expect(isSignupAllowed('octocat')).toBe(true)
  })

  it('ignores empty entries from trailing or doubled commas', () => {
    process.env.ALLOWED_GITHUB_USERS = 'crod951,,'
    expect(isSignupAllowed('')).toBe(false)
    expect(isSignupAllowed('crod951')).toBe(true)
  })

  it('fails closed in production when the allowlist is unset', () => {
    process.env.NODE_ENV = 'production'
    expect(isSignupAllowed('crod951')).toBe(false)
  })

  it('fails closed in production when the allowlist is only whitespace', () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOWED_GITHUB_USERS = '  ,  '
    expect(isSignupAllowed('crod951')).toBe(false)
  })

  it('fails open outside production when the allowlist is unset', () => {
    process.env.NODE_ENV = 'development'
    expect(isSignupAllowed('anyone')).toBe(true)
  })

  it('still enforces an explicit allowlist outside production', () => {
    process.env.NODE_ENV = 'development'
    process.env.ALLOWED_GITHUB_USERS = 'crod951'
    expect(isSignupAllowed('anyone')).toBe(false)
  })
})
