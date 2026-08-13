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
})
