import { describe, expect, it } from 'vitest'
import { appendEvent, createComposition } from '../../shared/composition'
import { measureEvents } from './measure'

describe('engraving adapter', () => {
  it('renders empty measures as rests without storing generated events', () => {
    const score = createComposition()
    expect(measureEvents(score, score.tracks[0]!.staves[0]!, 0)).toEqual([
      { id: 'rest-0', kind: 'rest', startTick: 0, durationTicks: 1920, implicit: true },
    ])
    expect(score.tracks[0]!.staves[0]!.events).toHaveLength(0)
  })
  it('fills gaps before and after a note, respecting rhythmic alignment', () => {
    const score = createComposition()
    score.tracks[0]!.staves[0]!.events = [
      {
        id: 'note',
        kind: 'note',
        startTick: 240,
        durationTicks: 120,
        pitch: { step: 'C', octave: 4, accidental: '' },
        velocity: 80,
      },
    ]
    const events = measureEvents(score, score.tracks[0]!.staves[0]!, 0)
    expect(events.map((event) => event.durationTicks)).toEqual([240, 120, 120, 480, 960])
    expect(events[1]!.id).toBe('note')
    expect(events.reduce((sum, event) => sum + event.durationTicks, 0)).toBe(1920)
  })
  it('keeps explicit rests and separates bars', () => {
    const original = createComposition()
    const score = appendEvent(original, original.tracks[0]!.id, 1, {
      kind: 'rest',
      durationTicks: 480,
    })
    expect(measureEvents(score, score.tracks[0]!.staves[0]!, 0)).toHaveLength(1)
    const events = measureEvents(score, score.tracks[0]!.staves[0]!, 1)
    expect(events[0]!.implicit).toBeUndefined()
    expect(events.map((event) => event.durationTicks)).toEqual([480, 480, 960])
  })
})
