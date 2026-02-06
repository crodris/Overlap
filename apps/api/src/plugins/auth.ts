import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import cookie from '@fastify/cookie'
import { db, users } from '@overlap/db'
import { eq } from 'drizzle-orm'

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string
      githubId: number
      username: string
      email: string | null
      avatarUrl: string | null
    } | null
  }
}

export async function authPlugin(fastify: FastifyInstance) {
  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required')
  }

  await fastify.register(cookie, {
    secret: sessionSecret,
    hook: 'onRequest',
    parseOptions: {},
  })

  fastify.decorateRequest('user', null)

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const signed = request.cookies.session
    if (!signed) return

    const unsigned = request.unsignCookie(signed)
    if (!unsigned.valid || !unsigned.value) return

    let parsed: { userId: string }
    try {
      parsed = JSON.parse(unsigned.value)
    } catch {
      return
    }

    if (!parsed.userId) return

    const user = await db.query.users.findFirst({
      where: eq(users.id, parsed.userId),
    })

    if (user) {
      request.user = {
        id: user.id,
        githubId: user.githubId,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
      }
    }
  })
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }
}
