import { describe, expect, it } from 'vitest'
import {
  appendEvent,
  createComposition,
  createExample,
  createTrack,
  parseComposition,
  pitchToMidi,
  removeLastEvent,
  serializeComposition,
  ticksPerMeasure,
} from './composition'

describe('composition model', () => {
  it('creates independent scores and a valid four-bar example', () => {
    const a = createComposition()
    const b = createComposition()
    expect(a.id).not.toBe(b.id)
    expect(a.tracks[0]!.id).not.toBe(b.tracks[0]!.id)
    expect(parseComposition(createExample()).tracks[0]!.staves[0]!.events).toHaveLength(13)
    expect(ticksPerMeasure(a)).toBe(1920)
  })

  it('round-trips the versioned JSON format without UI state', () => {
    const score = createExample()
    expect(parseComposition(JSON.parse(serializeComposition(score)))).toEqual(score)
    expect(parseComposition({ ...score, selectedMeasure: 3 })).not.toHaveProperty('selectedMeasure')
  })

  it('appends notes/rests immutably in the selected part and bar', () => {
    const original = createComposition()
    const cello = createTrack('Cello', 'bass', 42)
    const score = { ...original, tracks: [...original.tracks, cello] }
    const note = appendEvent(score, cello.id, 1, {
      kind: 'note',
      durationTicks: 960,
      pitch: { step: 'C', octave: 3, accidental: '#' },
    })
    const rest = appendEvent(note, cello.id, 1, { kind: 'rest', durationTicks: 960 })
    expect(rest.tracks[1]!.staves[0]!.events.map((event) => event.startTick)).toEqual([1920, 2880])
    expect(rest.tracks[1]!.staves[0]!.events[1]!.kind).toBe('rest')
    expect(original.tracks[0]!.staves[0]!.events).toHaveLength(0)
    expect(cello.staves[0]!.events).toHaveLength(0)
    expect(() => appendEvent(rest, cello.id, 1, { kind: 'rest', durationTicks: 120 })).toThrow(
      /full/,
    )
    expect(removeLastEvent(rest, cello.id, 1).tracks[1]!.staves[0]!.events).toEqual(
      note.tracks[1]!.staves[0]!.events,
    )
  })

  it('converts spelled pitches into MIDI note numbers', () => {
    expect(pitchToMidi({ step: 'C', octave: 4, accidental: '' })).toBe(60)
    expect(pitchToMidi({ step: 'B', octave: 3, accidental: '#' })).toBe(60)
    expect(pitchToMidi({ step: 'D', octave: 4, accidental: 'b' })).toBe(61)
  })

  it.each([
    [
      'version',
      (score: Record<string, unknown>) => {
        score.schemaVersion = 999
      },
    ],
    [
      'title',
      (score: Record<string, unknown>) => {
        score.title = ''
      },
    ],
    [
      'tempo',
      (score: Record<string, unknown>) => {
        score.tempoBpm = 0
      },
    ],
    [
      'fractional tempo',
      (score: Record<string, unknown>) => {
        score.tempoBpm = 100.5
      },
    ],
    [
      'missing part',
      (score: Record<string, unknown>) => {
        score.tracks = []
      },
    ],
    [
      'too many bars',
      (score: Record<string, unknown>) => {
        score.measureCount = 65
      },
    ],
    [
      'key',
      (score: Record<string, unknown>) => {
        score.keySignature = 'G'
      },
    ],
    [
      'time',
      (score: Record<string, unknown>) => {
        score.timeSignature = { numerator: 7, denominator: 8 }
      },
    ],
  ])('rejects unsupported %s on import', (_name, mutate) => {
    const score = JSON.parse(serializeComposition(createExample())) as Record<string, unknown>
    mutate(score)
    expect(() => parseComposition(score)).toThrow()
  })

  it('rejects overlapping, off-grid, out-of-range, and cross-bar events', () => {
    const score = createExample()
    const event = score.tracks[0]!.staves[0]!.events[1]!
    const invalidEvents = [
      { ...event, startTick: 0 },
      { ...event, startTick: 481 },
      { ...event, durationTicks: 333 },
      { ...event, startTick: 1800 },
      { ...event, velocity: 128 },
      { ...event, pitch: { step: 'G', octave: 9, accidental: '#' } },
      { ...event, id: score.id },
    ]
    for (const invalid of invalidEvents) {
      const copy = structuredClone(score)
      copy.tracks[0]!.staves[0]!.events[1] = invalid as typeof event
      expect(() => parseComposition(copy)).toThrow()
    }
  })

  it('supports triple time and rejects a whole note in a three-beat bar', () => {
    const score = createComposition()
    score.timeSignature.numerator = 3
    expect(ticksPerMeasure(parseComposition(score))).toBe(1440)
    expect(() =>
      appendEvent(score, score.tracks[0]!.id, 0, { kind: 'rest', durationTicks: 1920 }),
    ).toThrow(/duration/)
  })
})
