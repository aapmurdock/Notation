/** Canonical, serializable score data. No Electron, React, or VexFlow dependencies. */
export const PPQ = 480
export const SCHEMA_VERSION = 2
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
export interface Staff {
  id: string
  clef: 'treble' | 'bass'
  events: ScoreEvent[]
}
export interface Track {
  id: string
  name: string
  instrument: { kind: 'general-midi'; program: number }
  staves: Staff[]
}
export interface Composition {
  schemaVersion: 2
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

export function createTrack(name: string, clef: Staff['clef'], program: number): Track {
  return {
    id: uid(),
    name,
    instrument: { kind: 'general-midi', program },
    staves: (program === 0 ? (['treble', 'bass'] as const) : [clef]).map((clef) => ({
      id: uid(),
      clef,
      events: [],
    })),
  }
}

export function createExample(): Composition {
  const score = createComposition()
  score.title = 'A little beginning'
  const melody: Step[] = ['C', 'D', 'E', 'G', 'A', 'G', 'E', 'D', 'F', 'E', 'D', 'C']
  score.tracks[0]!.staves[0]!.events = melody.map((step, index) => ({
    id: uid(),
    kind: 'note',
    startTick: index * PPQ,
    durationTicks: PPQ,
    pitch: { step, octave: 4, accidental: '' },
    velocity: 80,
  }))
  score.tracks[0]!.staves[0]!.events.push({
    id: uid(),
    kind: 'note',
    startTick: 12 * PPQ,
    durationTicks: 1920,
    pitch: { step: 'C', octave: 4, accidental: '' },
    velocity: 80,
  })
  score.tracks[0]!.staves[1]!.events = (
    [
      ['C', 3],
      ['A', 2],
      ['F', 2],
      ['C', 3],
    ] as const
  ).map(([step, octave], index) => ({
    id: uid(),
    kind: 'note',
    startTick: index * 1920,
    durationTicks: 1920,
    pitch: { step, octave, accidental: '' },
    velocity: 72,
  }))
  return score
}

export function pitchToMidi(pitch: Pitch): number {
  const semitones: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  return (
    (pitch.octave + 1) * 12 +
    semitones[pitch.step] +
    (pitch.accidental === '#' ? 1 : pitch.accidental === 'b' ? -1 : 0)
  )
}

export type EventInput =
  | { kind: 'note'; durationTicks: DurationTicks; pitch: Pitch }
  | { kind: 'rest'; durationTicks: DurationTicks }

export function getStaff(score: Composition, trackId: string, staffId: string): Staff {
  const staff = score.tracks
    .find((part) => part.id === trackId)
    ?.staves.find((staff) => staff.id === staffId)
  if (!staff) throw new Error('Select a valid staff first.')
  return staff
}

/** Insert at musical time without moving existing music or crossing a barline. */
export function insertEvent(
  score: Composition,
  trackId: string,
  staffId: string,
  startTick: number,
  input: EventInput,
): Composition {
  const staff = getStaff(score, trackId, staffId)
  const barTicks = ticksPerMeasure(score)
  if (!Number.isInteger(startTick) || startTick < 0 || startTick >= score.measureCount * barTicks) {
    throw new Error('End of score. Select a measure or add another measure to continue.')
  }
  if (startTick + input.durationTicks > (Math.floor(startTick / barTicks) + 1) * barTicks) {
    throw new Error(
      'The duration crosses the barline. Choose a shorter duration or another measure.',
    )
  }
  if (
    staff.events.some(
      (event) =>
        event.startTick < startTick + input.durationTicks &&
        event.startTick + event.durationTicks > startTick,
    )
  ) {
    throw new Error('This beat is occupied. Select and delete the existing entry first.')
  }
  const event: ScoreEvent =
    input.kind === 'note'
      ? { ...input, id: uid(), startTick, velocity: 80 }
      : { ...input, id: uid(), startTick }
  return parseComposition({
    ...score,
    tracks: score.tracks.map((part) =>
      part.id === trackId
        ? {
            ...part,
            staves: part.staves.map((item) =>
              item.id === staffId
                ? {
                    ...item,
                    events: [...item.events, event].sort((a, b) => a.startTick - b.startTick),
                  }
                : item,
            ),
          }
        : part,
    ),
  })
}

/** Compatibility helper for the original append workflow, now with an explicit staff. */
export function appendEvent(
  score: Composition,
  trackId: string,
  measure: number,
  input: EventInput,
  staffId = score.tracks.find((part) => part.id === trackId)?.staves[0]?.id ?? '',
): Composition {
  if (!Number.isInteger(measure) || measure < 0 || measure >= score.measureCount)
    throw new Error('Select a valid measure.')
  const staff = getStaff(score, trackId, staffId)
  const barTicks = ticksPerMeasure(score)
  const barStart = measure * barTicks
  const startTick = staff.events
    .filter((event) => Math.floor(event.startTick / barTicks) === measure)
    .reduce((end, event) => Math.max(end, event.startTick + event.durationTicks), barStart)
  if (startTick + input.durationTicks > barStart + barTicks)
    throw new Error('This measure is full, or the duration is too long.')
  return insertEvent(score, trackId, staffId, startTick, input)
}

export function deleteEvent(score: Composition, staffId: string, eventId: string): Composition {
  return {
    ...score,
    tracks: score.tracks.map((track) => ({
      ...track,
      staves: track.staves.map((staff) =>
        staff.id === staffId
          ? { ...staff, events: staff.events.filter((event) => event.id !== eventId) }
          : staff,
      ),
    })),
  }
}

/** Find an available cursor position, independently for each staff. */
export function nextFreeTick(staff: Staff, from: number): number {
  let tick = from
  for (const event of staff.events) {
    if (event.startTick <= tick && event.startTick + event.durationTicks > tick)
      tick = event.startTick + event.durationTicks
  }
  return tick
}

export function removeLastEvent(
  score: Composition,
  trackId: string,
  measure: number,
  staffId?: string,
): Composition {
  const staff = score.tracks
    .find((track) => track.id === trackId)
    ?.staves.find((staff, index) => (staffId ? staff.id === staffId : index === 0))
  const last = staff?.events
    .filter((event) => Math.floor(event.startTick / ticksPerMeasure(score)) === measure)
    .at(-1)
  return staff && last ? deleteEvent(score, staff.id, last.id) : score
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a score object.')
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
  let source = record(input)
  if (source.schemaVersion === 1) source = migrateVersionOne(source)
  if (source.schemaVersion !== SCHEMA_VERSION)
    throw new Error('Unsupported score version. Expected version 1 or 2.')
  const signature = record(source.timeSignature)
  const numerator = oneOf(signature.numerator, [3, 4] as const, 'time signature')
  if (signature.denominator !== 4)
    throw new Error('Only quarter-note time signatures are supported.')
  const measureCount = integer(source.measureCount, 1, 64, 'Measure count')
  const barTicks = numerator * PPQ
  const ids = new Set<string>()
  const uniqueId = (value: unknown): string => {
    const id = text(value, 'ID', 200)
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
    const staves = list(track.staves, 1, 2, 'Staves').map((value): Staff => {
      const staff = record(value)
      const staffId = uniqueId(staff.id)
      const clef = oneOf(staff.clef, ['treble', 'bass'] as const, 'clef')
      let endTick = 0
      const events = list(staff.events, 0, 4096, 'Events').map((value): ScoreEvent => {
        const event = record(value)
        const startTick = integer(event.startTick, 0, measureCount * barTicks - 1, 'Event position')
        const durationTicks = oneOf(event.durationTicks, DURATIONS, 'duration')
        if (startTick % 120 !== 0) throw new Error('Events must align to the sixteenth-note grid.')
        if (startTick < endTick)
          throw new Error('Each staff supports sorted, non-overlapping events.')
        if (
          Math.floor(startTick / barTicks) !==
          Math.floor((startTick + durationTicks - 1) / barTicks)
        ) {
          throw new Error(
            'Events cannot cross a barline. Ties will be supported in a future milestone.',
          )
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
        return {
          ...base,
          kind: 'note',
          pitch: parsedPitch,
          velocity: integer(event.velocity, 1, 127, 'Velocity'),
        }
      })
      return { id: staffId, clef, events }
    })
    if (staves.length === 2 && (staves[0]!.clef !== 'treble' || staves[1]!.clef !== 'bass')) {
      throw new Error('A grand staff must contain treble followed by bass.')
    }
    return {
      id: trackId,
      name: text(track.name, 'Part name', 60),
      instrument: { kind: 'general-midi', program: integer(instrument.program, 0, 127, 'Program') },
      staves,
    }
  })
  return {
    schemaVersion: 2,
    id,
    title: text(source.title, 'Title'),
    tempoBpm: integer(source.tempoBpm, 30, 240, 'Tempo'),
    timeSignature: { numerator, denominator: 4 },
    keySignature: oneOf(source.keySignature, ['C'] as const, 'key signature'),
    measureCount,
    tracks,
  }
}

export function serializeComposition(score: Composition): string {
  return JSON.stringify(parseComposition(score), null, 2) + '\n'
}

/** Milestone 1 notes, IDs, pitches, and ticks are retained on their original clef. */
function migrateVersionOne(source: Record<string, unknown>): Record<string, unknown> {
  const tracks = list(source.tracks, 1, 16, 'Parts').map(record)
  const usedIds = new Set<unknown>([source.id])
  for (const track of tracks) {
    usedIds.add(track.id)
    for (const event of list(track.events, 0, 4096, 'Events')) usedIds.add(record(event).id)
  }
  const staffId = (partId: string, clef: string): string => {
    const base = `${partId}/staff-${clef}`
    let candidate = base
    let suffix = 1
    while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`
    usedIds.add(candidate)
    return candidate
  }
  return {
    ...source,
    schemaVersion: 2,
    tracks: tracks.map((track) => {
      const instrument = record(track.instrument)
      const clef = oneOf(track.clef, ['treble', 'bass'] as const, 'clef')
      const id = text(track.id, 'ID')
      const staves = instrument.program === 0 ? (['treble', 'bass'] as const) : [clef]
      return {
        ...track,
        staves: staves.map((staffClef) => ({
          id: staffId(id, staffClef),
          clef: staffClef,
          events: staffClef === clef ? track.events : [],
        })),
      }
    }),
  }
}
