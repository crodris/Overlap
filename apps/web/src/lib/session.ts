import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE_NAME = 'session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

const ALGORITHM = 'HS256'

function getKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is required')
  }
  return new TextEncoder().encode(secret)
}

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getKey())
}

export async function verifySession(
  token: string
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getKey(), {
      algorithms: [ALGORITHM],
    })
    const userId = payload.userId
    if (typeof userId !== 'string') return null
    return { userId }
  } catch {
    return null
  }
}
