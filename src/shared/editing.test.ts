import { describe, expect, it } from 'vitest'
import {
  createComposition,
  createExample,
  deleteEvent,
  insertEvent,
  parseComposition,
  pitchToMidi,
  serializeComposition,
  type Composition,
  type Pitch,
  type DurationTicks,
} from './composition'
import {
  changeDuration,
  changePitch,
  changeSignature,
  history,
  recordEdit,
  redo,
  toggleTies,
  undo,
  updateEvents,
} from './editing'
import {
  KEY_SIGNATURES,
  TIME_SIGNATURES,
  measureAtTick,
  measureStart,
  measureTicks,
  resolvedPitch,
  scoreEnd,
} from './signatures'

const pitch = (step: Pitch['step'], octave = 4, accidental: Pitch['accidental'] = ''): Pitch => ({
  step,
  octave,
  accidental,
})
function add(
  score: Composition,
  tick: number,
  value: Pitch,
  duration: DurationTicks = 480,
  chord = false,
  staffIndex = 0,
) {
  return insertEvent(
    score,
    score.tracks[0]!.id,
    score.tracks[0]!.staves[staffIndex]!.id,
    tick,
    { kind: 'note', pitch: value, durationTicks: duration },
    chord,
  )
}
const events = (score: Composition) => score.tracks[0]!.staves[0]!.events
const midi = (score: Composition, tick: number, value: Pitch) =>
  pitchToMidi(resolvedPitch(score, score.tracks[0]!.staves[0]!, tick, value))

describe('key-aware pitches', () => {
  it('supports every major/minor signature, including explicit naturals and enharmonic keys', () => {
    for (const [key] of KEY_SIGNATURES) {
      const score = changeSignature(createComposition(), 0, { keySignature: key })
      expect(parseComposition(JSON.parse(serializeComposition(score)))).toEqual(score)
    }
    const g = changeSignature(createComposition(), 0, { keySignature: 'G' })
    expect(midi(g, 0, pitch('F'))).toBe(66)
    expect(midi(g, 0, pitch('F', 4, 'n'))).toBe(65)
    expect(midi(g, 0, pitch('F', 4, 'b'))).toBe(64)
    const minor = changeSignature(g, 0, { keySignature: 'Dm' })
    expect(midi(minor, 0, pitch('B', 2))).toBe(46)
    const flat = changeSignature(g, 0, { keySignature: 'Cb' })
    expect(midi(flat, 0, pitch('C'))).toBe(59)
  })
  it('carries explicit accidentals within the same staff, octave, and bar, then resets', () => {
    let score = add(createComposition(), 0, pitch('F', 4, '#'))
    score = add(score, 480, pitch('F'))
    expect(midi(score, 480, pitch('F'))).toBe(66)
    expect(midi(score, 480, pitch('F', 3))).toBe(53)
    expect(midi(score, 1920, pitch('F'))).toBe(65)
    score = add(score, 960, pitch('F', 4, 'n'))
    expect(midi(score, 1440, pitch('F'))).toBe(65)
    const bass = score.tracks[0]!.staves[1]!
    expect(pitchToMidi(resolvedPitch(score, bass, 480, pitch('F')))).toBe(65)
  })
})

describe('advanced canonical edits', () => {
  it('repitches without changing ID, duration, velocity, timing, or the other staff', () => {
    let original = add(createComposition(), 240, pitch('E'), 720)
    original = add(original, 240, pitch('C', 3), 480, false, 1)
    const note = events(original)[0]!
    const next = changePitch(original, note.id, pitch('B', 3, 'b'))
    expect(events(next)[0]).toEqual({ ...note, pitch: pitch('B', 3, 'b') })
    expect(next.tracks[0]!.staves[1]).toEqual(original.tracks[0]!.staves[1])
    expect(events(original)[0]).toEqual(note)
  })
  it('retains per-tone identity and renders a single rhythm for simultaneous chord tones', () => {
    let score = add(createComposition(), 0, pitch('C'))
    const first = events(score)[0]!
    score = add(score, 0, pitch('E'), 480, true)
    score = add(score, 0, pitch('G'), 480, true)
    expect(events(score)).toHaveLength(3)
    expect(events(score)[0]!.id).toBe(first.id)
    const dotted = changeDuration(score, [first.id], 720)
    expect(events(dotted).map((event) => event.durationTicks)).toEqual([720, 720, 720])
    expect(events(dotted).map((event) => event.startTick)).toEqual([0, 0, 0])
    expect(() => add(score, 0, pitch('C'), 480, true)).toThrow(/duplicate/)
    expect(() => add(score, 0, pitch('B'), 960, true)).toThrow(/occupied/)
    expect(() => add(score, 240, pitch('B'), 480, true)).toThrow(/occupied/)
    expect(events(deleteEvent(score, score.tracks[0]!.staves[0]!.id, first.id))).toHaveLength(2)
  })
  it('edits dotted notes/rests and rejects occupied time or barline overflow atomically', () => {
    let score = add(createComposition(), 0, pitch('C'), 180)
    score = insertEvent(score, score.tracks[0]!.id, score.tracks[0]!.staves[0]!.id, 180, {
      kind: 'rest',
      durationTicks: 360,
    })
    expect(events(score).map((event) => event.durationTicks)).toEqual([180, 360])
    expect(() => changeDuration(score, [events(score)[0]!.id], 240)).toThrow(/Overlapping/)
    const last = add(createComposition(), 1440, pitch('D'))
    expect(() => changeDuration(last, [events(last)[0]!.id], 720)).toThrow(/barline/)
    expect(events(last)[0]!.durationTicks).toBe(480)
  })
  it('creates/removes ties across barlines and cleans incoming ties on deletion', () => {
    let score = add(createComposition(), 1440, pitch('C'))
    score = add(score, 1920, pitch('C'), 960)
    const [from, to] = events(score)
    const tied = toggleTies(score, [from!.id])
    expect(events(tied)[0]).toMatchObject({ tieTo: to!.id })
    expect(() => changePitch(tied, to!.id, pitch('D'))).toThrow(/tie/)
    expect(events(deleteEvent(tied, tied.tracks[0]!.staves[0]!.id, to!.id))[0]).not.toHaveProperty(
      'tieTo',
    )
    expect(events(toggleTies(tied, [from!.id]))[0]).not.toHaveProperty('tieTo')
    expect(() => toggleTies(score, [to!.id])).toThrow(/adjacent/)
  })
  it('round-trips chords, accidentals, dots, ties, and measure signatures together', () => {
    let score = add(createComposition(), 0, pitch('C', 4, '#'), 720)
    score = add(score, 0, pitch('E'), 720, true)
    score = add(score, 720, pitch('C', 4, '#'), 120)
    score = toggleTies(score, [events(score)[0]!.id])
    score = changeSignature(score, 2, {
      timeSignature: { numerator: 6, denominator: 8 },
      keySignature: 'Bbm',
    })
    expect(parseComposition(JSON.parse(serializeComposition(score)))).toEqual(score)
    const edited = updateEvents(score, [events(score)[1]!.id], (event) =>
      event.kind === 'note' ? { ...event, pitch: { ...event.pitch, accidental: 'n' } } : event,
    )
    expect(parseComposition(JSON.parse(serializeComposition(edited)))).toEqual(edited)
  })
  it('migrates version 2 without losing note identity, spelling, or tick positions', () => {
    const score = createExample()
    const legacy = JSON.parse(serializeComposition(score))
    legacy.schemaVersion = 2
    delete legacy.signatureChanges
    expect(parseComposition(legacy)).toEqual(score)
  })
})

describe('safe signature changes', () => {
  it('supports all requested meters and a variable measure timeline', () => {
    for (const time of TIME_SIGNATURES) {
      const score = changeSignature(createComposition(), 0, { timeSignature: time })
      expect(measureTicks(score)).toBe((time.numerator * 480 * 4) / time.denominator)
    }
    const score = changeSignature(createComposition(), 1, {
      timeSignature: { numerator: 3, denominator: 4 },
    })
    expect([0, 1, 2, 3, 4].map((bar) => measureStart(score, bar))).toEqual([
      0, 1920, 3360, 4800, 6240,
    ])
    expect(measureAtTick(score, 3360)).toBe(2)
    expect(scoreEnd(score)).toBe(6240)
  })
  it('preserves measure-relative beat, IDs, spelling, and duration when downstream tick starts change', () => {
    let score = add(createComposition(), 1920 + 480, pitch('F', 4, '#'))
    score = add(score, 3840, pitch('C', 3), 720, false, 1)
    const changed = changeSignature(score, 0, { timeSignature: { numerator: 3, denominator: 4 } })
    expect(events(changed)[0]).toEqual({ ...events(score)[0], startTick: 1440 + 480 })
    expect(changed.tracks[0]!.staves[1]!.events[0]!.startTick).toBe(2880)
    expect(events(score)[0]!.startTick).toBe(2400)
  })
  it('rejects destructive meter changes; key edits never rewrite stored notes', () => {
    const score = add(createComposition(), 1440, pitch('E'))
    expect(() =>
      changeSignature(score, 0, { timeSignature: { numerator: 3, denominator: 4 } }),
    ).toThrow(/will not fit/)
    const keyed = changeSignature(score, 0, { keySignature: 'Eb' })
    expect(keyed.tracks).toEqual(score.tracks)
    expect(() =>
      parseComposition({ ...score, signatureChanges: [{ measure: 4, keySignature: 'G' }] }),
    ).toThrow()
  })
})

describe('undo and redo', () => {
  it('treats a drag or batch edit as one command, restores exact documents, and clears the redo branch', () => {
    const initial = createComposition()
    const entered = add(initial, 0, pitch('E'))
    const dragged = changePitch(entered, events(entered)[0]!.id, pitch('G'))
    let state = recordEdit(recordEdit(history(initial), entered), dragged)
    state = undo(state)
    expect(state.present).toEqual(entered)
    state = undo(state)
    expect(state.present).toEqual(initial)
    expect(undo(state)).toBe(state)
    state = redo(state)
    expect(state.present).toEqual(entered)
    state = redo(state)
    expect(state.present).toEqual(dragged)
    expect(redo(state)).toBe(state)
    state = recordEdit(undo(state), changeDuration(entered, [events(entered)[0]!.id], 720))
    expect(state.future).toEqual([])
    expect(recordEdit(state, state.present)).toBe(state)
  })
})
