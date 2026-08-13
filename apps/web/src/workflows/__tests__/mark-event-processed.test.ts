import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * `markEventProcessed` used to branch on `error ? ... : ...`, which meant an
 * empty-string error message (falsy but not absent) silently took the
 * success path and set `processedAt` instead of recording the error. The fix
 * branches on `error !== undefined` instead. These tests pin that: a defined
 * error, including an empty string, must always take the error path, and
 * only a genuinely omitted error takes the success path.
 *
 * The success path also used to leave a stale `error` from a previous failed
 * attempt in place, since it only ever set `processedAt`. A row updated by a
 * successful GitHub Redeliver after an earlier failure would then show both
 * `error` and `processedAt` set, misrepresenting a cured delivery as failed
 * in the one operator-facing table for delivery outcomes. The success path
 * now clears `error` explicitly.
 */

const { dbMock, setSpy } = vi.hoisted(() => {
  const setSpy = vi.fn()

  const dbMock = {
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        setSpy(values)
        return {
          where: vi.fn(async () => undefined),
        }
      }),
    })),
  }

  return { dbMock, setSpy }
})

vi.mock('@overlap/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@overlap/db')>()
  return { ...actual, db: dbMock }
})

const { markEventProcessed } = await import('../steps')

const DELIVERY_ID = 'delivery-1'

describe('markEventProcessed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records processedAt and clears error when no error is passed', async () => {
    const result = await markEventProcessed(DELIVERY_ID)

    expect(setSpy).toHaveBeenCalledWith({ processedAt: expect.any(Date), error: null })
    expect(result).toEqual({ deliveryId: DELIVERY_ID })
  })

  it('clears a previous failure on a successful GitHub redelivery', async () => {
    // Simulates the Redeliver scenario: a delivery previously failed and
    // recorded an error, an operator fixes the cause and redelivers, and the
    // retry succeeds. The row must not be left claiming both outcomes.
    await markEventProcessed(DELIVERY_ID, 'boom')
    setSpy.mockClear()

    await markEventProcessed(DELIVERY_ID)

    expect(setSpy).toHaveBeenCalledWith({ processedAt: expect.any(Date), error: null })
  })

  it('records the error when a non-empty error message is passed', async () => {
    await markEventProcessed(DELIVERY_ID, 'boom')

    expect(setSpy).toHaveBeenCalledWith({ error: 'boom' })
  })

  it('takes the error path, not the success path, for an empty-string error', async () => {
    await markEventProcessed(DELIVERY_ID, '')

    expect(setSpy).toHaveBeenCalledWith({ error: '' })
  })
})
