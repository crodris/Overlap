import { FatalError, RetryableError } from 'workflow'

type GitHubErrorLike = {
  status?: number
  message?: string
  response?: { headers?: Record<string, string | undefined> }
}

/**
 * GitHub reports Retry-After as a whole number of seconds.
 *
 * Anything else - an HTTP-date, an empty string, a malformed value - falls
 * back to the default rather than being passed through, because
 * `RetryableError` throws when `ms` cannot parse the duration string. Passing
 * an unparseable header straight through would turn a rate limit into a crash
 * inside the very catch block that is meant to handle it.
 */
function retryAfterFromHeader(header: string | undefined): `${number}s` | '5m' {
  if (header === undefined) {
    return '5m'
  }

  const trimmed = header.trim()
  if (trimmed === '') {
    return '5m'
  }

  const seconds = Number(trimmed)
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '5m'
  }

  return `${seconds}s`
}

export function classifyGitHubError(err: GitHubErrorLike): Error {
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
