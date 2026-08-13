import { db, users } from '@overlap/db'
import { eq } from 'drizzle-orm'
import {
  verifySession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from './session'

export type AuthUser = {
  id: string
  githubId: number
  username: string
  email: string | null
  avatarUrl: string | null
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim()
    }
  }
  return null
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function buildSessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ]
  if (isProduction()) parts.push('Secure')
  return parts.join('; ')
}

export function buildClearCookie(name: string): string {
  const parts = [`${name}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
  if (isProduction()) parts.push('Secure')
  return parts.join('; ')
}

export async function getUser(request: Request): Promise<AuthUser | null> {
  const token = readCookie(request, SESSION_COOKIE_NAME)
  if (!token) return null

  const session = await verifySession(token)
  if (!session) return null

  // Retained deliberately: this lookup is what makes revocation immediate.
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  })
  if (!user) return null

  return {
    id: user.id,
    githubId: user.githubId,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
  }
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const user = await getUser(request)
  if (!user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  return user
}
