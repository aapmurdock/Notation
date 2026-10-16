import type { Pitch, Staff, Step } from '../../shared/composition'

const steps: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
export const diatonic = (pitch: Pitch): number => pitch.octave * 7 + steps.indexOf(pitch.step)
export const bottomPitch = (clef: Staff['clef']): number => (clef === 'treble' ? 30 : 18) // E4 / G2

export function pitchAtY(
  y: number,
  bottomY: number,
  spacing: number,
  clef: Staff['clef'],
  accidental: Pitch['accidental'] = '',
): Pitch {
  const index = Math.max(
    0,
    Math.min(67, bottomPitch(clef) + Math.round(((bottomY - y) * 2) / spacing)),
  )
  return { step: steps[index % 7]!, octave: Math.floor(index / 7), accidental }
}

export function yForPitch(
  pitch: Pitch,
  bottomY: number,
  spacing: number,
  clef: Staff['clef'],
): number {
  return bottomY - ((diatonic(pitch) - bottomPitch(clef)) * spacing) / 2
}

export function transposeStep(pitch: Pitch, amount: number): Pitch {
  const index = Math.max(0, Math.min(67, diatonic(pitch) + amount))
  return { ...pitch, step: steps[index % 7]!, octave: Math.floor(index / 7) }
}

export interface Column {
  measure: number
  x: number
  width: number
  header: number
}
export interface SystemLayout {
  columns: Column[]
  width: number
}

/** Pack engraving-engine minimums into systems, sharing every column across all parts. */
export function planSystems(
  minimums: number[],
  availableWidth: number,
  headers?: { start: number; middle: number }[],
): SystemLayout[] {
  const left = 86
  const right = 16
  const width = Math.max(
    availableWidth,
    left +
      right +
      Math.max(...minimums.map((minimum, index) => minimum + (headers?.[index]?.start ?? 84))),
  )
  const systems: SystemLayout[] = []
  let measure = 0
  while (measure < minimums.length) {
    const columns: Column[] = []
    let used = left + right
    while (measure < minimums.length) {
      const header = headers
        ? columns.length === 0
          ? headers[measure]!.start
          : headers[measure]!.middle
        : columns.length === 0
          ? measure === 0
            ? 84
            : 58
          : 0
      const minimum = minimums[measure]! + header
      if (columns.length && used + minimum > width) break
      columns.push({ measure, x: used - right, width: minimum, header })
      used += minimum
      measure++
    }
    const extra = (width - used) / columns.length
    let x = left
    for (const column of columns) {
      column.x = x
      column.width += extra
      x += column.width
    }
    systems.push({ columns, width })
  }
  return systems
}

export interface TickAnchor {
  tick: number
  x: number
}

/** Interpolate empty beats using the actual formatter's neighboring tick positions. */
export function xForTick(anchors: TickAnchor[], tick: number): number {
  const afterIndex = anchors.findIndex((anchor) => anchor.tick >= tick)
  if (afterIndex === -1) return anchors.at(-1)!.x
  if (afterIndex <= 0) return anchors[Math.max(0, afterIndex)]!.x
  const before = anchors[afterIndex - 1]!
  const after = anchors[afterIndex]!
  return before.x + ((after.x - before.x) * (tick - before.tick)) / (after.tick - before.tick)
}

export function tickAtX(
  anchors: TickAnchor[],
  x: number,
  barStart: number,
  barTicks: number,
  grid: number,
): number {
  const slots = Array.from(
    { length: Math.ceil(barTicks / grid) },
    (_, index) => barStart + index * grid,
  )
  return slots.reduce(
    (nearest, tick) =>
      Math.abs(xForTick(anchors, tick) - x) < Math.abs(xForTick(anchors, nearest) - x)
        ? tick
        : nearest,
    barStart,
  )
}
