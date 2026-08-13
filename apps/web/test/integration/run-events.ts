/**
 * Reads a run's durable event log.
 *
 * This is the record the workflow runtime itself keeps, not something the test
 * observes from the side, which is what makes it the right place to assert a
 * happens-before edge between two steps.
 */

import { getWorld } from 'workflow/runtime'

export type StepLogEntry = {
  /** Position in the run's event log. */
  index: number
  eventType: string
  /** As recorded, e.g. `step//./src/workflows/steps//syncBranchFiles`. */
  qualifiedName: string
  /** Trailing segment of the above, e.g. `syncBranchFiles`. */
  stepName: string
  correlationId: string
}

type RawEvent = {
  eventType: string
  correlationId?: string
  eventData?: { stepName?: string }
}

/**
 * Every `step_*` event of a run, in log order, with `stepName` filled in for
 * the event types that only carry it on `step_created`.
 */
export async function stepLog(runId: string): Promise<StepLogEntry[]> {
  const world = getWorld()
  const events: RawEvent[] = []

  let cursor: string | null = null
  do {
    const page = await world.events.list({
      runId,
      pagination: { limit: 1000, ...(cursor ? { cursor } : {}) },
      resolveData: 'none',
    })
    events.push(...(page.data as unknown as RawEvent[]))
    cursor = page.hasMore ? page.cursor : null
  } while (cursor)

  const namesByCorrelationId = new Map<string, string>()
  for (const event of events) {
    const name = event.eventData?.stepName
    if (event.correlationId && name) {
      namesByCorrelationId.set(event.correlationId, name)
    }
  }

  return events.flatMap((event, index) => {
    if (!event.eventType.startsWith('step_')) return []
    const correlationId = event.correlationId ?? ''
    const qualifiedName =
      event.eventData?.stepName ??
      namesByCorrelationId.get(correlationId) ??
      '<unknown>'
    return [
      {
        index,
        eventType: event.eventType,
        qualifiedName,
        stepName: qualifiedName.split('//').pop() ?? qualifiedName,
        correlationId,
      },
    ]
  })
}

/** Index in the step log of the first `eventType` for `stepName`, or -1. */
export function firstIndexOf(
  log: StepLogEntry[],
  eventType: string,
  stepName: string
): number {
  return log.findIndex(
    (entry) => entry.eventType === eventType && entry.stepName === stepName
  )
}

export function countOf(
  log: StepLogEntry[],
  eventType: string,
  stepName: string
): number {
  return log.filter(
    (entry) => entry.eventType === eventType && entry.stepName === stepName
  ).length
}
