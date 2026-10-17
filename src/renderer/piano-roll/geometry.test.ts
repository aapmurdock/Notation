import { describe, expect, it } from 'vitest'
import { createComposition } from '../../shared/composition'
import { changeSignature } from '../../shared/editing'
import { SNAP_CHOICES } from '../../shared/piano-roll'
import { xAtTick, tickAtX, yAtMidi, midiAtY, timelineMarks } from './geometry'

describe('piano-roll coordinates and timeline', () => {
  it.each([48, 96, 192, 384])('maps musical time and pitch at quarter width %d', (width) => {
    for (const { ticks } of SNAP_CHOICES)
      expect(tickAtX(xAtTick(ticks * 3, width), width, ticks)).toBe(ticks * 3)
    for (const height of [12, 18, 26])
      for (const midi of [12, 48, 60, 61, 127])
        expect(midiAtY(yAtMidi(midi, height) + height / 2, height)).toBe(midi)
  })
  it('shows eighth-note pulses and dotted-quarter grouping in 6/8 without fractional ticks', () => {
    const score = changeSignature(createComposition(), 1, {
      timeSignature: { numerator: 6, denominator: 8 },
    })
    const marks = timelineMarks(score, 60)
    expect(marks.find((mark) => mark.tick === 1920)).toMatchObject({ kind: 'measure', label: '2' })
    expect(marks.find((mark) => mark.tick === 2160)).toMatchObject({ kind: 'beat', label: '2.2' })
    expect(marks.find((mark) => mark.tick === 2640)).toMatchObject({
      kind: 'compound',
      label: '2.4',
    })
    expect(marks.find((mark) => mark.tick === 3360)).toMatchObject({ kind: 'measure', label: '3' })
    expect(marks.every((mark) => Number.isInteger(mark.tick))).toBe(true)
    expect(timelineMarks(score, 480).length).toBeLessThan(marks.length)
  })
})
