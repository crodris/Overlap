/**
 * Controls who is allowed to create a brand new account.
 *
 * Existing users are never checked against this gate - the caller looks them up
 * by the immutable `github_id` first, so an approved user keeps access even if
 * they rename themselves on GitHub.
 *
 * `ALLOWED_GITHUB_USERS` is a comma-separated list of GitHub logins. When it is
 * unset we fail CLOSED in production (a forgotten env var locks sign-ups rather
 * than opening them) and fail OPEN everywhere else so local development and
 * tests are unaffected.
 */

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

export function isSignupAllowed(githubLogin: string): boolean {
  const allowlist = parseAllowlist(process.env.ALLOWED_GITHUB_USERS)

  if (allowlist.length === 0) {
    return process.env.NODE_ENV !== 'production'
  }

  return allowlist.includes(githubLogin.trim().toLowerCase())
}
