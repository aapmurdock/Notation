/** Canonical, serializable score data. No Electron, React, or VexFlow dependencies. */
export const PPQ = 480
export const SCHEMA_VERSION = 1
export const DURATIONS = [1920, 960, 480, 240, 120] as const
export type DurationTicks = (typeof DURATIONS)[number]
export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'
export interface Pitch {
  step: Step
  octave: number
  accidental: '' | '#' | 'b'
}
interface EventBase {
  id: string
  startTick: number
  durationTicks: DurationTicks
}
export type ScoreEvent =
  | (EventBase & { kind: 'note'; pitch: Pitch; velocity: number })
  | (EventBase & { kind: 'rest' })
export interface Track {
  id: string
  name: string
  clef: 'treble' | 'bass'
  instrument: { kind: 'general-midi'; program: number }
  events: ScoreEvent[]
}
export interface Composition {
  schemaVersion: 1
  id: string
  title: string
  tempoBpm: number
  timeSignature: { numerator: 3 | 4; denominator: 4 }
  keySignature: 'C'
  measureCount: number
  tracks: Track[]
}

const uid = (): string => crypto.randomUUID()

export function ticksPerMeasure(score: Composition): number {
  return score.timeSignature.numerator * PPQ
}

export function createComposition(): Composition {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid(),
    title: 'Untitled composition',
    tempoBpm: 100,
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: 'C',
    measureCount: 4,
    tracks: [createTrack('Piano', 'treble', 0)],
  }
}

export function createTrack(name: string, clef: Track['clef'], program: number): Track {
  return { id: uid(), name, clef, instrument: { kind: 'general-midi', program }, events: [] }
}

export function createExample(): Composition {
  const score = createComposition()
  score.title = 'A little beginning'
  const melody: Step[] = ['C', 'D', 'E', 'G', 'A', 'G', 'E', 'D', 'F', 'E', 'D', 'C']
  score.tracks[0]!.events = melody.map((step, index) => ({
    id: uid(), kind: 'note', startTick: index * PPQ, durationTicks: PPQ,
    pitch: { step, octave: 4, accidental: '' }, velocity: 80,
  }))
  score.tracks[0]!.events.push({
    id: uid(), kind: 'note', startTick: 12 * PPQ, durationTicks: 1920,
    pitch: { step: 'C', octave: 4, accidental: '' }, velocity: 80,
  })
  return score
}

export function pitchToMidi(pitch: Pitch): number {
  const semitones: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  return (pitch.octave + 1) * 12 + semitones[pitch.step]
    + (pitch.accidental === '#' ? 1 : pitch.accidental === 'b' ? -1 : 0)
}

/** Append within one bar. The first milestone supports one voice per part. */
export function appendEvent(
  score: Composition, trackId: string, measure: number,
  input: { kind: 'note'; durationTicks: DurationTicks; pitch: Pitch }
    | { kind: 'rest'; durationTicks: DurationTicks },
): Composition {
  const track = score.tracks.find((part) => part.id === trackId)
  if (!track) throw new Error('Select a part first.')
  if (!Number.isInteger(measure) || measure < 0 || measure >= score.measureCount) {
    throw new Error('Select a valid measure.')
  }
  const barTicks = ticksPerMeasure(score)
  const barStart = measure * barTicks
  const startTick = track.events
    .filter((event) => event.startTick >= barStart && event.startTick < barStart + barTicks)
    .reduce((end, event) => Math.max(end, event.startTick + event.durationTicks), barStart)
  if (startTick + input.durationTicks > barStart + barTicks) {
    throw new Error('This measure is full, or the duration is too long. Choose a shorter duration or another measure.')
  }
  const event: ScoreEvent = input.kind === 'note'
    ? { ...input, id: uid(), startTick, velocity: 80 }
    : { ...input, id: uid(), startTick }
  const result = {
    ...score,
    tracks: score.tracks.map((part) => part.id === trackId
      ? { ...part, events: [...part.events, event].sort((a, b) => a.startTick - b.startTick) }
      : part),
  }
  return parseComposition(result)
}

export function removeLastEvent(score: Composition, trackId: string, measure: number): Composition {
  const barTicks = ticksPerMeasure(score)
  const part = score.tracks.find((track) => track.id === trackId)
  const last = part?.events.filter((event) => Math.floor(event.startTick / barTicks) === measure).at(-1)
  if (!last) return score
  return { ...score, tracks: score.tracks.map((track) => track.id === trackId
    ? { ...track, events: track.events.filter((event) => event.id !== last.id) } : track) }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a score object.')
  return value as Record<string, unknown>
}
function text(value: unknown, field: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${field} must contain 1–${max} characters.`)
  }
  return value
}
function integer(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}.`)
  }
  return value
}
function oneOf<T extends string | number>(value: unknown, values: readonly T[], field: string): T {
  if (!values.includes(value as T)) throw new Error(`Unsupported ${field}.`)
  return value as T
}
function list(value: unknown, min: number, max: number, field: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${field} must contain ${min}–${max} items.`)
  }
  return value
}

/** Validate untrusted file/IPC data and return a fresh object, dropping unknown fields. */
export function parseComposition(input: unknown): Composition {
  const source = record(input)
  if (source.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported score version. Expected version 1.')
  const signature = record(source.timeSignature)
  const numerator = oneOf(signature.numerator, [3, 4] as const, 'time signature')
  if (signature.denominator !== 4) throw new Error('Only quarter-note time signatures are supported.')
  const measureCount = integer(source.measureCount, 1, 64, 'Measure count')
  const barTicks = numerator * PPQ
  const ids = new Set<string>()
  const uniqueId = (value: unknown): string => {
    const id = text(value, 'ID')
    if (ids.has(id)) throw new Error('Score IDs must be unique.')
    ids.add(id)
    return id
  }
  const id = uniqueId(source.id)
  const tracks = list(source.tracks, 1, 16, 'Parts').map((value): Track => {
    const track = record(value)
    const trackId = uniqueId(track.id)
    const instrument = record(track.instrument)
    if (instrument.kind !== 'general-midi') throw new Error('Unsupported instrument type.')
    let endTick = 0
    const events = list(track.events, 0, 4096, 'Events').map((value): ScoreEvent => {
      const event = record(value)
      const startTick = integer(event.startTick, 0, measureCount * barTicks - 1, 'Event position')
      const durationTicks = oneOf(event.durationTicks, DURATIONS, 'duration')
      if (startTick % 120 !== 0) throw new Error('Events must align to the sixteenth-note grid.')
      if (startTick < endTick) throw new Error('Milestone 1 supports sorted, non-overlapping events in each part.')
      if (Math.floor(startTick / barTicks) !== Math.floor((startTick + durationTicks - 1) / barTicks)) {
        throw new Error('Events cannot cross a barline. Ties will be supported in a future milestone.')
      }
      endTick = startTick + durationTicks
      const base = { id: uniqueId(event.id), startTick, durationTicks }
      if (event.kind === 'rest') return { ...base, kind: 'rest' }
      if (event.kind !== 'note') throw new Error('Unsupported event type.')
      const pitch = record(event.pitch)
      const parsedPitch: Pitch = {
        step: oneOf(pitch.step, ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const, 'pitch'),
        octave: integer(pitch.octave, 0, 9, 'Octave'),
        accidental: oneOf(pitch.accidental, ['', '#', 'b'] as const, 'accidental'),
      }
      const midi = pitchToMidi(parsedPitch)
      if (midi < 0 || midi > 127) throw new Error('Pitch is outside the MIDI range.')
      return { ...base, kind: 'note', pitch: parsedPitch, velocity: integer(event.velocity, 1, 127, 'Velocity') }
    })
    return {
      id: trackId, name: text(track.name, 'Part name', 60),
      clef: oneOf(track.clef, ['treble', 'bass'] as const, 'clef'),
      instrument: { kind: 'general-midi', program: integer(instrument.program, 0, 127, 'Program') },
      events,
    }
  })
  return {
    schemaVersion: 1, id, title: text(source.title, 'Title'),
    tempoBpm: integer(source.tempoBpm, 30, 240, 'Tempo'),
    timeSignature: { numerator, denominator: 4 },
    keySignature: oneOf(source.keySignature, ['C'] as const, 'key signature'),
    measureCount, tracks,
  }
}

export function serializeComposition(score: Composition): string {
  return JSON.stringify(parseComposition(score), null, 2) + '\n'
}
