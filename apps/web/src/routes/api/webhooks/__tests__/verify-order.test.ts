import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleWebhook } from '../github-handler'

const inserts = vi.fn()
const starts = vi.fn()
const findRepository = vi.fn()
const findWebhookEvent = vi.fn()
const updates = vi.fn()

vi.mock('@overlap/db', () => ({
  db: {
    insert: () => ({ values: inserts }),
    query: {
      repositories: { findFirst: (...args: unknown[]) => findRepository(...args) },
      webhookEvents: { findFirst: (...args: unknown[]) => findWebhookEvent(...args) },
    },
    update: () => ({
      set: (values: unknown) => ({
        where: (condition: unknown) => updates(values, condition),
      }),
    }),
  },
  webhookEvents: {},
  repositories: { githubId: 'githubId' },
}))

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`
}

beforeEach(() => {
  inserts.mockReset()
  starts.mockReset()
  findRepository.mockReset()
  findWebhookEvent.mockReset()
  updates.mockReset()
  process.env.GITHUB_WEBHOOK_SECRET = 'test-secret'
})

describe('handleWebhook', () => {
  it('rejects an invalid signature with 401', async () => {
    const req = new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'abc-123',
        'x-hub-signature-256': 'sha256=deadbeef',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    })

    const res = await handleWebhook(req, { start: starts })
    expect(res.status).toBe(401)
  })

  it('writes nothing to the database when the signature is invalid', async () => {
    const req = new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'abc-123',
        'x-hub-signature-256': 'sha256=deadbeef',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    })

    await handleWebhook(req, { start: starts })
    expect(inserts).not.toHaveBeenCalled()
  })

  it('starts no workflow when the signature is invalid', async () => {
    const req = new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'abc-123',
        'x-hub-signature-256': 'sha256=deadbeef',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'refs/heads/main' }),
    })

    await handleWebhook(req, { start: starts })
    expect(starts).not.toHaveBeenCalled()
  })

  it('accepts a valid signature, stores the event, and starts the workflow', async () => {
    const body = JSON.stringify({ ref: 'refs/heads/main' })
    const signature = sign(body, 'test-secret')

    inserts.mockReturnValue({
      onConflictDoNothing: () => ({
        returning: () =>
          Promise.resolve([
            { id: 'row-1', deliveryId: 'abc-123', eventType: 'push', payload: {} },
          ]),
      }),
    })

    const req = new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'abc-123',
        'x-hub-signature-256': signature,
        'content-type': 'application/json',
      },
      body,
    })

    const res = await handleWebhook(req, { start: starts })

    expect(res.status).toBe(200)
    expect(inserts).toHaveBeenCalledTimes(1)
    expect(starts).toHaveBeenCalledTimes(1)
    expect(starts.mock.calls[0]?.[1]).toEqual(['abc-123'])
    // dispatchedAt is only recorded once start() has actually returned.
    expect(updates).toHaveBeenCalledTimes(1)
    expect(updates.mock.calls[0]?.[0]).toMatchObject({ dispatchedAt: expect.any(Date) })
  })

  describe('redelivery of an already-stored deliveryId (onConflictDoNothing returns no row)', () => {
    function redeliveredRequest() {
      const body = JSON.stringify({ ref: 'refs/heads/main' })
      const signature = sign(body, 'test-secret')

      inserts.mockReturnValue({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([]),
        }),
      })

      return new Request('https://example.com/api/webhooks/github', {
        method: 'POST',
        headers: {
          'x-github-event': 'push',
          'x-github-delivery': 'abc-123',
          'x-hub-signature-256': signature,
          'content-type': 'application/json',
        },
        body,
      })
    }

    it('restarts the workflow when dispatchedAt is null (no run was ever created)', async () => {
      findWebhookEvent.mockResolvedValue({
        id: 'row-1',
        deliveryId: 'abc-123',
        dispatchedAt: null,
        error: null,
        processedAt: null,
      })

      const res = await handleWebhook(redeliveredRequest(), { start: starts })

      expect(res.status).toBe(200)
      expect(starts).toHaveBeenCalledTimes(1)
      expect(starts.mock.calls[0]?.[1]).toEqual(['abc-123'])
      expect(updates).toHaveBeenCalledTimes(1)
    })

    it('does NOT restart when a run is in flight (dispatchedAt set, no error, not yet processed)', async () => {
      findWebhookEvent.mockResolvedValue({
        id: 'row-1',
        deliveryId: 'abc-123',
        dispatchedAt: new Date('2026-01-01T00:00:00Z'),
        error: null,
        processedAt: null,
      })

      const res = await handleWebhook(redeliveredRequest(), { start: starts })

      expect(res.status).toBe(200)
      expect(starts).not.toHaveBeenCalled()
      expect(updates).not.toHaveBeenCalled()
    })

    it('restarts the workflow when the prior run terminally failed (error set, not processed)', async () => {
      findWebhookEvent.mockResolvedValue({
        id: 'row-1',
        deliveryId: 'abc-123',
        dispatchedAt: new Date('2026-01-01T00:00:00Z'),
        error: 'GitHub API returned 500',
        processedAt: null,
      })

      const res = await handleWebhook(redeliveredRequest(), { start: starts })

      expect(res.status).toBe(200)
      expect(starts).toHaveBeenCalledTimes(1)
      expect(starts.mock.calls[0]?.[1]).toEqual(['abc-123'])
      expect(updates).toHaveBeenCalledTimes(1)
    })

    it('does NOT restart when the delivery already finished (processedAt set)', async () => {
      findWebhookEvent.mockResolvedValue({
        id: 'row-1',
        deliveryId: 'abc-123',
        dispatchedAt: new Date('2026-01-01T00:00:00Z'),
        error: null,
        processedAt: new Date('2026-01-01T00:05:00Z'),
      })

      const res = await handleWebhook(redeliveredRequest(), { start: starts })

      expect(res.status).toBe(200)
      expect(starts).not.toHaveBeenCalled()
      expect(updates).not.toHaveBeenCalled()
    })
  })

  it('rejects a validly-signed delivery with no x-github-delivery header with 400', async () => {
    const body = JSON.stringify({ ref: 'refs/heads/main' })
    const signature = sign(body, 'test-secret')

    const req = new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-hub-signature-256': signature,
        'content-type': 'application/json',
      },
      body,
    })

    const res = await handleWebhook(req, { start: starts })

    expect(res.status).toBe(400)
    expect(inserts).not.toHaveBeenCalled()
    expect(starts).not.toHaveBeenCalled()
  })

  it('rejects a validly-signed `null` JSON body with 400 instead of throwing', async () => {
    const body = 'null'
    const signature = sign(body, 'test-secret')

    const req = new Request('https://example.com/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'push',
        'x-github-delivery': 'abc-123',
        'x-hub-signature-256': signature,
        'content-type': 'application/json',
      },
      body,
    })

    const res = await handleWebhook(req, { start: starts })

    expect(res.status).toBe(400)
    expect(inserts).not.toHaveBeenCalled()
    expect(starts).not.toHaveBeenCalled()
  })
})
