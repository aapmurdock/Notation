import { DURATIONS, ticksPerMeasure, type Composition, type ScoreEvent, type Track } from '../../shared/composition'

export type DisplayEvent = ScoreEvent & { implicit?: boolean }

/** Fill gaps for engraving only. Implicit rests never alter the composition. */
export function measureEvents(score: Composition, track: Track, measure: number): DisplayEvent[] {
  const length = ticksPerMeasure(score)
  const start = measure * length
  const result: DisplayEvent[] = []
  let cursor = start
  const fillTo = (end: number): void => {
    while (cursor < end) {
      const durationTicks = DURATIONS.find((duration) => duration <= end - cursor && (cursor - start) % duration === 0)
      if (!durationTicks) throw new Error('Cannot render an event outside the sixteenth-note grid.')
      result.push({ id: `rest-${cursor}`, kind: 'rest', startTick: cursor, durationTicks, implicit: true })
      cursor += durationTicks
    }
  }
  for (const event of track.events.filter((event) => event.startTick >= start && event.startTick < start + length)) {
    fillTo(event.startTick)
    result.push(event)
    cursor = event.startTick + event.durationTicks
  }
  fillTo(start + length)
  return result
}
