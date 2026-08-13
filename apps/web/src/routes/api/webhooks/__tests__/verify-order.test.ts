import { createHmac } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleWebhook } from '../github-handler'

const inserts = vi.fn()
const starts = vi.fn()
const findFirst = vi.fn()

vi.mock('@overlap/db', () => ({
  db: {
    insert: () => ({ values: inserts }),
    query: { repositories: { findFirst: (...args: unknown[]) => findFirst(...args) } },
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
  findFirst.mockReset()
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
  })

  it('returns 200 without starting a workflow on redelivery of an already-accepted delivery', async () => {
    const body = JSON.stringify({ ref: 'refs/heads/main' })
    const signature = sign(body, 'test-secret')

    // onConflictDoNothing().returning() resolves empty: the unique constraint
    // on deliveryId rejected the insert because this delivery was already
    // accepted.
    inserts.mockReturnValue({
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve([]),
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
    expect(starts).not.toHaveBeenCalled()
  })
})
