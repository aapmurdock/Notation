import type { Composition, Pitch, Staff, Step } from './composition'

export const KEY_SIGNATURES = [
  ['C', 'C major', 0],
  ['G', 'G major', 1],
  ['D', 'D major', 2],
  ['A', 'A major', 3],
  ['E', 'E major', 4],
  ['B', 'B major', 5],
  ['F#', 'F♯ major', 6],
  ['C#', 'C♯ major', 7],
  ['F', 'F major', -1],
  ['Bb', 'B♭ major', -2],
  ['Eb', 'E♭ major', -3],
  ['Ab', 'A♭ major', -4],
  ['Db', 'D♭ major', -5],
  ['Gb', 'G♭ major', -6],
  ['Cb', 'C♭ major', -7],
  ['Am', 'A minor', 0],
  ['Em', 'E minor', 1],
  ['Bm', 'B minor', 2],
  ['F#m', 'F♯ minor', 3],
  ['C#m', 'C♯ minor', 4],
  ['G#m', 'G♯ minor', 5],
  ['D#m', 'D♯ minor', 6],
  ['A#m', 'A♯ minor', 7],
  ['Dm', 'D minor', -1],
  ['Gm', 'G minor', -2],
  ['Cm', 'C minor', -3],
  ['Fm', 'F minor', -4],
  ['Bbm', 'B♭ minor', -5],
  ['Ebm', 'E♭ minor', -6],
  ['Abm', 'A♭ minor', -7],
] as const
export type KeySignature = (typeof KEY_SIGNATURES)[number][0]
export interface TimeSignature {
  numerator: 2 | 3 | 4 | 6
  denominator: 4 | 8
}
export interface SignatureChange {
  /** Zero-based measure index. Measure zero uses the composition's initial signatures. */
  measure: number
  timeSignature?: TimeSignature
  keySignature?: KeySignature
}
export const TIME_SIGNATURES: TimeSignature[] = [
  { numerator: 2, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 4, denominator: 4 },
  { numerator: 6, denominator: 8 },
]
export const timeName = (time: TimeSignature): string => `${time.numerator}/${time.denominator}`
export const keyName = (key: KeySignature): string =>
  KEY_SIGNATURES.find((item) => item[0] === key)![1]

export function signatureAt(score: Composition, measure: number) {
  let timeSignature = score.timeSignature,
    keySignature = score.keySignature
  for (const change of score.signatureChanges) {
    if (change.measure > measure) break
    timeSignature = change.timeSignature ?? timeSignature
    keySignature = change.keySignature ?? keySignature
  }
  return { timeSignature, keySignature }
}
export function measureTicks(score: Composition, measure = 0): number {
  const time = signatureAt(score, measure).timeSignature
  return time.numerator * ((480 * 4) / time.denominator)
}
export function measureStart(score: Composition, measure: number): number {
  let tick = 0
  for (let index = 0; index < measure; index++) tick += measureTicks(score, index)
  return tick
}
export const scoreEnd = (score: Composition): number => measureStart(score, score.measureCount)
export function measureAtTick(score: Composition, tick: number): number {
  let start = 0
  for (let measure = 0; measure < score.measureCount; measure++) {
    start += measureTicks(score, measure)
    if (tick < start) return measure
  }
  return score.measureCount
}
export function keyAccidental(key: KeySignature, step: Step): Pitch['accidental'] {
  const count = KEY_SIGNATURES.find((item) => item[0] === key)![2]
  const order: string = count > 0 ? 'FCGDAEB' : 'BEADGCF'
  return order.slice(0, Math.abs(count)).includes(step) ? (count > 0 ? '#' : 'b') : ''
}

/** Empty means follow the key/earlier explicit accidental; 'n' is an explicit natural. */
export function resolvedPitch(
  score: Composition,
  staff: Staff,
  tick: number,
  pitch: Pitch,
  excludeId?: string,
): Pitch {
  let accidental = keyAccidental(
    signatureAt(score, measureAtTick(score, tick)).keySignature,
    pitch.step,
  )
  const start = measureStart(score, measureAtTick(score, tick))
  for (const event of staff.events) {
    if (event.startTick >= tick) break
    if (
      event.startTick >= start &&
      event.kind === 'note' &&
      event.id !== excludeId &&
      event.pitch.step === pitch.step &&
      event.pitch.octave === pitch.octave &&
      event.pitch.accidental
    )
      accidental = event.pitch.accidental === 'n' ? '' : event.pitch.accidental
  }
  return { ...pitch, accidental: pitch.accidental === 'n' ? '' : pitch.accidental || accidental }
}
