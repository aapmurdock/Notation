import { describe, expect, it } from 'vitest'
import {
  createComposition,
  createTrack,
  deleteEvent,
  insertEvent,
  nextFreeTick,
  parseComposition,
  serializeComposition,
} from './composition'

describe('multi-staff editing and migration', () => {
  it('creates a piano grand staff and a single-staff violin', () => {
    expect(createComposition().tracks[0]!.staves.map((staff) => staff.clef)).toEqual([
      'treble',
      'bass',
    ])
    expect(createTrack('Violin', 'treble', 40).staves).toHaveLength(1)
  })
  it('allows simultaneous treble and bass notes without changing musical time', () => {
    const initial = createComposition()
    const piano = initial.tracks[0]!
    const treble = piano.staves[0]!,
      bass = piano.staves[1]!
    const first = insertEvent(initial, piano.id, treble.id, 0, {
      kind: 'note',
      durationTicks: 480,
      pitch: { step: 'E', octave: 4, accidental: '' },
    })
    const second = insertEvent(first, piano.id, bass.id, 0, {
      kind: 'note',
      durationTicks: 960,
      pitch: { step: 'C', octave: 3, accidental: '' },
    })
    expect(initial.tracks[0]!.staves[0]!.events).toHaveLength(0)
    expect(nextFreeTick(second.tracks[0]!.staves[0]!, 0)).toBe(480)
    expect(nextFreeTick(second.tracks[0]!.staves[1]!, 0)).toBe(960)
    expect(parseComposition(JSON.parse(serializeComposition(second)))).toEqual(second)
    const deleted = deleteEvent(second, treble.id, second.tracks[0]!.staves[0]!.events[0]!.id)
    expect(deleted.tracks[0]!.staves[0]!.events).toHaveLength(0)
    expect(deleted.tracks[0]!.staves[1]!.events).toEqual(second.tracks[0]!.staves[1]!.events)
  })
  it('enforces overlap, sixteenth-grid, barline, and score-end boundaries', () => {
    const initial = createComposition(),
      part = initial.tracks[0]!,
      staff = part.staves[0]!
    const input = { kind: 'rest' as const, durationTicks: 480 as const }
    const score = insertEvent(initial, part.id, staff.id, 0, input)
    expect(() => insertEvent(score, part.id, staff.id, 240, input)).toThrow(/occupied/)
    expect(() => insertEvent(score, part.id, staff.id, 1800, input)).toThrow(/barline/)
    expect(() => insertEvent(score, part.id, staff.id, 481, input)).toThrow(/grid/)
    expect(() => insertEvent(score, part.id, staff.id, 7680, input)).toThrow(/End of score/)
    const next = insertEvent(score, part.id, staff.id, 1920, input)
    expect(next.tracks[0]!.staves[0]!.events[1]!.startTick).toBe(1920)
  })
  it.each(['treble', 'bass'] as const)(
    'migrates version 1 piano music on its original %s clef',
    (clef) => {
      const base = createComposition()
      const event = {
        id: 'old-note',
        kind: 'note',
        startTick: 1920,
        durationTicks: 480,
        pitch: { step: 'C', octave: clef === 'bass' ? 3 : 4, accidental: '#' },
        velocity: 80,
      }
      const legacy = {
        ...base,
        schemaVersion: 1,
        tracks: [
          {
            id: 'old-part',
            name: 'Piano',
            clef,
            instrument: { kind: 'general-midi', program: 0 },
            events: [event],
          },
        ],
      }
      const migrated = parseComposition(legacy)
      expect(migrated.schemaVersion).toBe(3)
      expect(migrated.id).toBe(base.id)
      expect(migrated.tracks[0]!.id).toBe('old-part')
      expect(migrated.tracks[0]!.staves.find((staff) => staff.clef === clef)!.events).toEqual([
        event,
      ])
      expect(migrated.tracks[0]!.staves.find((staff) => staff.clef !== clef)!.events).toEqual([])
      expect(parseComposition(legacy)).toEqual(migrated)
      expect(legacy.tracks[0]!.events).toEqual([event])
    },
  )
  it('keeps non-piano legacy parts single-staff and rejects malformed grand staves', () => {
    const base = createComposition()
    const legacy = {
      ...base,
      schemaVersion: 1,
      tracks: [
        {
          id: 'cello',
          name: 'Cello',
          clef: 'bass',
          instrument: { kind: 'general-midi', program: 42 },
          events: [],
        },
      ],
    }
    expect(parseComposition(legacy).tracks[0]!.staves).toHaveLength(1)
    base.tracks[0]!.staves.reverse()
    expect(() => parseComposition(base)).toThrow(/grand staff/)
  })

  it('adds staff IDs without colliding with valid legacy event IDs', () => {
    const legacy = {
      ...createComposition(),
      schemaVersion: 1,
      tracks: [
        {
          id: 'piano',
          name: 'Piano',
          clef: 'treble',
          instrument: { kind: 'general-midi', program: 0 },
          events: [{ id: 'piano/staff-treble', kind: 'rest', startTick: 0, durationTicks: 480 }],
        },
      ],
    }
    const score = parseComposition(legacy)
    expect(score.tracks[0]!.staves[0]!.id).toBe('piano/staff-treble-1')
    expect(score.tracks[0]!.staves[0]!.events[0]!.id).toBe('piano/staff-treble')
  })
})
