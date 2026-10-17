import { DURATIONS, type Composition, type ScoreEvent, type Staff } from '../../shared/composition'
import { measureStart, measureTicks } from '../../shared/signatures'

export type DisplayEvent = ScoreEvent & { implicit?: boolean; source?: ScoreEvent }

/** Exact, display-only fragments. The canonical note retains one ID and duration. */
export function measureEvents(score: Composition, staff: Staff, measure: number): DisplayEvent[] {
  const length = measureTicks(score, measure),
    start = measureStart(score, measure)
  const end = start + length
  const result: DisplayEvent[] = []
  let cursor = start
  const fillTo = (target: number): void => {
    while (cursor < target) {
      const durationTicks = [1920, 960, 480, 240, 120, 60].find(
        (duration) => duration <= target - cursor && (cursor - start) % duration === 0,
      )
      if (!durationTicks)
        throw new Error('Cannot render an event outside the thirty-second-note grid.')
      result.push({
        id: `rest-${cursor}`,
        kind: 'rest',
        startTick: cursor,
        durationTicks,
        implicit: true,
      })
      cursor += durationTicks
    }
  }
  for (const event of staff.events.filter(
    (event) => event.startTick < end && event.startTick + event.durationTicks > start,
  )) {
    let tick = Math.max(event.startTick, start)
    const stop = Math.min(event.startTick + event.durationTicks, end)
    fillTo(tick)
    while (tick < stop) {
      const durationTicks = DURATIONS.find((duration) => duration <= stop - tick)!
      const fragment = tick !== event.startTick || durationTicks !== event.durationTicks
      result.push({
        ...event,
        startTick: tick,
        durationTicks,
        ...(fragment ? { source: event } : {}),
      })
      tick += durationTicks
    }
    cursor = Math.max(cursor, stop)
  }
  fillTo(end)
  // Chord tones may each split into several fragments; group the same fragment onset together.
  return result.sort((a, b) => a.startTick - b.startTick)
}
