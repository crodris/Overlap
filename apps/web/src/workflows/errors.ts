import { FatalError, RetryableError } from 'workflow'

type GitHubErrorLike = {
  status?: number
  message?: string
  response?: { headers?: Record<string, string | undefined> }
}

/** Longest backoff we will honor from a Retry-After header. */
const MAX_RETRY_AFTER_SECONDS = 3600

/**
 * Resolves the Retry-After header into a duration string that is always safe
 * to hand to `RetryableError`.
 *
 * `RetryableError` throws when `ms` cannot parse the duration, so a value that
 * reaches the constructor unvalidated turns a rate limit into a crash inside
 * the very catch block meant to handle it. Two rules keep that from happening:
 *
 *  - Only a bare run of digits is accepted. RFC 9110 also permits an HTTP-date,
 *    and `Number()` additionally accepts hex, exponent, signed and fractional
 *    forms - none of which are a seconds count, and several of which stringify
 *    back into something `ms` rejects (`1e21` becomes `"1e+21s"`).
 *  - The value is capped at one hour. Digits alone can still exceed the Date
 *    range (anything past ~8.64e12 seconds yields an Invalid Date) or park a
 *    step for centuries. An hour comfortably covers a GitHub primary rate
 *    limit reset, which is the longest wait this backoff legitimately needs.
 *
 * Anything outside those rules falls back to the 5m default.
 */
function retryAfterFromHeader(header: string | undefined): `${number}s` | '5m' {
  if (header === undefined) {
    return '5m'
  }

  const trimmed = header.trim()
  if (!/^\d+$/.test(trimmed)) {
    return '5m'
  }

  const seconds = Math.min(Number(trimmed), MAX_RETRY_AFTER_SECONDS)
  return `${seconds}s`
}

export function classifyGitHubError(err: GitHubErrorLike): Error {
  // Callers funnel everything through here with `error as never`, so anything
  // thrown anywhere in the call stack arrives - including null and primitives.
  if (typeof err !== 'object' || err === null) {
    return new RetryableError('GitHub request failed', { retryAfter: '30s' })
  }

  const status = err.status
  const message = err.message ?? 'GitHub request failed'

  if (status === 429 || status === 403) {
    const retryAfter = retryAfterFromHeader(
      err.response?.headers?.['retry-after']
    )
    return new RetryableError(`GitHub rate limited: ${message}`, { retryAfter })
  }

  if (status !== undefined && status >= 400 && status < 500) {
    return new FatalError(message)
  }

  // 5xx, network failures and unknown shapes are transient.
  return new RetryableError(message, { retryAfter: '30s' })
}
