import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FatalError, RetryableError } from 'workflow'
import { classifyGitHubError } from '../errors'

// `RetryableError` normalizes the `retryAfter` option into an absolute Date at
// construction time, so the duration string is asserted as the instant it
// resolves to. Freezing the clock keeps that instant deterministic.
const NOW = new Date('2026-01-01T00:00:00.000Z')

describe('classifyGitHubError', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps 429 to RetryableError honoring Retry-After', () => {
    const err = classifyGitHubError({
      status: 429,
      message: 'rate limited',
      response: { headers: { 'retry-after': '120' } },
    })
    expect(err).toBeInstanceOf(RetryableError)
    expect((err as RetryableError).retryAfter).toEqual(
      new Date(NOW.getTime() + 120_000)
    )
  })

  it('maps 403 to RetryableError', () => {
    const err = classifyGitHubError({ status: 403, message: 'forbidden' })
    expect(err).toBeInstanceOf(RetryableError)
  })

  it('defaults Retry-After to 5m when the header is absent', () => {
    const err = classifyGitHubError({ status: 429, message: 'rate limited' })
    expect((err as RetryableError).retryAfter).toEqual(
      new Date(NOW.getTime() + 300_000)
    )
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

  // A Retry-After the constructor cannot parse would throw out of the
  // classifier itself, stripping the 429 of its RetryableError classification.
  // These cover the hostile shapes that reach `ms` as a duration string.
  const rateLimited = (retryAfter: string) =>
    classifyGitHubError({
      status: 429,
      message: 'rate limited',
      response: { headers: { 'retry-after': retryAfter } },
    })

  it('caps an oversized Retry-After at one hour rather than throwing', () => {
    const err = rateLimited('1000000000000000000000')
    expect(err).toBeInstanceOf(RetryableError)
    expect((err as RetryableError).retryAfter).toEqual(
      new Date(NOW.getTime() + 3_600_000)
    )
  })

  it('caps a Retry-After that would overflow the Date range', () => {
    const err = rateLimited('99999999999999')
    expect((err as RetryableError).retryAfter).toEqual(
      new Date(NOW.getTime() + 3_600_000)
    )
  })

  it('ignores a Retry-After in exponent notation', () => {
    const err = rateLimited('1e21')
    expect((err as RetryableError).retryAfter).toEqual(
      new Date(NOW.getTime() + 300_000)
    )
  })

  it('ignores a hexadecimal Retry-After', () => {
    const err = rateLimited('0x10')
    expect((err as RetryableError).retryAfter).toEqual(
      new Date(NOW.getTime() + 300_000)
    )
  })

  it('returns a RetryableError when the thrown value is not an object', () => {
    const err = classifyGitHubError(null as never)
    expect(err).toBeInstanceOf(RetryableError)
    expect(err.message).toBe('GitHub request failed')
    expect((err as RetryableError).retryAfter).toEqual(
      new Date(NOW.getTime() + 30_000)
    )
  })
})
