import { PPQ, type Composition } from '../../shared/composition'
import { measureStart, signatureAt } from '../../shared/signatures'
import { HIGHEST_MIDI, LOWEST_MIDI, snapTick, type SnapTicks } from '../../shared/piano-roll'

export const KEYBOARD_WIDTH = 64
export const RULER_HEIGHT = 28
export const xAtTick = (tick: number, quarterWidth: number): number => (tick * quarterWidth) / PPQ
export const tickAtX = (x: number, quarterWidth: number, snap: SnapTicks): number =>
  Math.max(0, snapTick((x * PPQ) / quarterWidth, snap))
export const yAtMidi = (midi: number, rowHeight: number): number =>
  (HIGHEST_MIDI - midi) * rowHeight
export const midiAtY = (y: number, rowHeight: number): number =>
  Math.max(LOWEST_MIDI, Math.min(HIGHEST_MIDI, HIGHEST_MIDI - Math.floor(y / rowHeight)))
export interface TimelineMark {
  tick: number
  kind: 'measure' | 'beat' | 'division' | 'compound'
  label?: string
}
/** Static musical timeline shared by drawing/snapping; no playback clock or transport. */
export function timelineMarks(score: Composition, snap: SnapTicks): TimelineMark[] {
  const result: TimelineMark[] = []
  for (let measure = 0; measure < score.measureCount; measure++) {
    const start = measureStart(score, measure),
      end = measureStart(score, measure + 1)
    const time = signatureAt(score, measure).timeSignature
    const pulse = (PPQ * 4) / time.denominator
    for (let tick = start; tick < end; tick += Math.min(snap, pulse)) {
      const offset = tick - start
      const kind =
        offset === 0
          ? 'measure'
          : time.denominator === 8 && offset % (pulse * 3) === 0
            ? 'compound'
            : offset % pulse === 0
              ? 'beat'
              : 'division'
      // A coarse snap does not hide beats; a fine snap adds subdivisions.
      result.push({
        tick,
        kind,
        ...(kind === 'measure'
          ? { label: String(measure + 1) }
          : kind !== 'division'
            ? { label: `${measure + 1}.${offset / pulse + 1}` }
            : {}),
      })
    }
  }
  result.push({ tick: measureStart(score, score.measureCount), kind: 'measure', label: 'End' })
  return result
}
