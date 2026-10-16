import { describe, expect, it } from 'vitest'
import { pitchAtY, planSystems, tickAtX, xForTick, yForPitch } from './geometry'

describe('staff geometry', () => {
  it.each([
    ['treble', 100, 'E', 4],
    ['treble', 95, 'F', 4],
    ['treble', 60, 'F', 5],
    ['treble', 110, 'C', 4],
    ['bass', 100, 'G', 2],
    ['bass', 85, 'C', 3],
    ['bass', 60, 'A', 3],
  ] as const)('maps %s y=%d to %s%d', (clef, y, step, octave) => {
    const pitch = pitchAtY(y, 100, 10, clef)
    expect(pitch).toEqual({ step, octave, accidental: '' })
    expect(yForPitch(pitch, 100, 10, clef)).toBe(y)
  })
  it('rounds to the nearest line or space with the current accidental', () => {
    expect(pitchAtY(94, 100, 10, 'treble', '#')).toEqual({ step: 'F', octave: 4, accidental: '#' })
    expect(pitchAtY(98, 100, 10, 'treble')).toEqual({ step: 'E', octave: 4, accidental: '' })
  })
  it('snaps clicked x to selected durations using actual engraving anchors', () => {
    const anchors = [
      { tick: 1920, x: 100 },
      { tick: 2400, x: 180 },
      { tick: 3840, x: 360 },
    ]
    expect(xForTick(anchors, 2880)).toBe(240)
    expect(tickAtX(anchors, 180, 1920, 1920, 480)).toBe(2400)
    expect(tickAtX(anchors, 1000, 1920, 1920, 480)).toBe(3360)
    expect(tickAtX(anchors, 1000, 1920, 1920, 1920)).toBe(1920)
    expect(tickAtX(anchors, 1000, 1920, 1920, 120)).toBe(3720)
  })
})

describe('system planning', () => {
  it('joins consecutive measures exactly and wraps to additional systems', () => {
    const narrow = planSystems([160, 180, 140, 170, 160], 600)
    const wide = planSystems([160, 180, 140, 170, 160], 1100)
    expect(narrow.length).toBeGreaterThan(wide.length)
    expect(narrow.flatMap((system) => system.columns.map((column) => column.measure))).toEqual([
      0, 1, 2, 3, 4,
    ])
    for (const system of narrow) {
      system.columns.forEach((column, index) => {
        const next = system.columns[index + 1]
        if (next) expect(column.x + column.width).toBeCloseTo(next.x)
      })
      const end = system.columns.at(-1)!
      expect(end.x + end.width).toBeCloseTo(system.width - 16)
    }
  })
  it('retains readable spacing for an indivisible dense measure', () => {
    const systems = planSystems([600, 120], 400)
    expect(systems[0]!.width).toBeGreaterThan(400)
    expect(systems[0]!.columns[0]!.width).toBeGreaterThanOrEqual(684)
  })
})
