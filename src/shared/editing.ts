import {
  parseComposition,
  pitchToMidi,
  type Composition,
  type DurationTicks,
  type Pitch,
  type ScoreEvent,
} from './composition'
import {
  measureAtTick,
  measureStart,
  resolvedPitch,
  type KeySignature,
  type TimeSignature,
} from './signatures'

export function updateEvents(
  score: Composition,
  ids: string[],
  update: (event: ScoreEvent) => ScoreEvent,
): Composition {
  const selected = new Set(ids)
  return parseComposition({
    ...score,
    tracks: score.tracks.map((track) => ({
      ...track,
      staves: track.staves.map((staff) => ({
        ...staff,
        events: staff.events.map((event) => (selected.has(event.id) ? update(event) : event)),
      })),
    })),
  })
}
export function changePitch(score: Composition, id: string, pitch: Pitch): Composition {
  return updateEvents(score, [id], (event) => (event.kind === 'note' ? { ...event, pitch } : event))
}
/** Chord tones share one engraved rhythm. Resize all tones, or reject the whole edit. */
export function changeDuration(
  score: Composition,
  ids: string[],
  durationTicks: DurationTicks,
): Composition {
  const expanded = new Set(ids)
  for (const track of score.tracks)
    for (const staff of track.staves) {
      const selected = staff.events.filter((event) => expanded.has(event.id))
      for (const event of staff.events)
        if (selected.some((item) => item.startTick === event.startTick)) expanded.add(event.id)
    }
  return updateEvents(score, [...expanded], (event) => ({ ...event, durationTicks }))
}
export function toggleTies(score: Composition, ids: string[]): Composition {
  const targets = new Map<string, string | undefined>()
  for (const track of score.tracks)
    for (const staff of track.staves)
      for (const event of staff.events)
        if (ids.includes(event.id) && event.kind === 'note') {
          if (event.tieTo) {
            targets.set(event.id, undefined)
            continue
          }
          const midi = pitchToMidi(resolvedPitch(score, staff, event.startTick, event.pitch))
          const target = staff.events.find(
            (item) =>
              item.kind === 'note' &&
              item.startTick === event.startTick + event.durationTicks &&
              item.pitch.step === event.pitch.step &&
              item.pitch.octave === event.pitch.octave &&
              pitchToMidi(resolvedPitch(score, staff, item.startTick, item.pitch)) === midi,
          )
          if (!target)
            throw new Error(
              'Enter an adjacent note of the same pitch first, then select the earlier note to tie.',
            )
          targets.set(event.id, target.id)
        }
  return updateEvents(score, [...targets.keys()], (event) => {
    if (event.kind !== 'note') return event
    const { tieTo: _tieTo, ...note } = event
    return targets.get(event.id) ? { ...note, tieTo: targets.get(event.id) } : note
  })
}
/** Preserve measure and offset; reject overflow instead of truncating or moving beats. */
export function changeSignature(
  score: Composition,
  measure: number,
  change: { timeSignature?: TimeSignature; keySignature?: KeySignature },
): Composition {
  if (!Number.isInteger(measure) || measure < 0 || measure >= score.measureCount)
    throw new Error('Select a valid signature measure.')
  const next =
    measure === 0
      ? { ...score, ...change }
      : {
          ...score,
          signatureChanges: [
            ...score.signatureChanges.filter((item) => item.measure !== measure),
            {
              ...score.signatureChanges.find((item) => item.measure === measure),
              measure,
              ...change,
            },
          ].sort((a, b) => a.measure - b.measure),
        }
  if (change.timeSignature) {
    next.tracks = score.tracks.map((track) => ({
      ...track,
      staves: track.staves.map((staff) => ({
        ...staff,
        events: staff.events.map((event) => {
          const bar = measureAtTick(score, event.startTick)
          const offset = event.startTick - measureStart(score, bar)
          const startTick = measureStart(next, bar) + offset
          if (startTick + event.durationTicks > measureStart(next, bar + 1))
            throw new Error(
              `Measure ${bar + 1} contains music that will not fit. Shorten or move those entries before changing meter.`,
            )
          return { ...event, startTick }
        }),
      })),
    }))
  }
  return parseComposition(next)
}

export interface History<T> {
  past: T[]
  present: T
  future: T[]
}
export const history = <T>(present: T): History<T> => ({ past: [], present, future: [] })
export function recordEdit<T>(state: History<T>, present: T): History<T> {
  if (JSON.stringify(state.present) === JSON.stringify(present)) return state
  return { past: [...state.past.slice(-99), state.present], present, future: [] }
}
export function undo<T>(state: History<T>): History<T> {
  if (!state.past.length) return state
  return {
    past: state.past.slice(0, -1),
    present: state.past.at(-1)!,
    future: [state.present, ...state.future],
  }
}
export function redo<T>(state: History<T>): History<T> {
  if (!state.future.length) return state
  return {
    past: [...state.past, state.present],
    present: state.future[0]!,
    future: state.future.slice(1),
  }
}
