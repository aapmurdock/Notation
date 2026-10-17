import {
  parseComposition,
  pitchToMidi,
  type Composition,
  type Pitch,
  type ScoreEvent,
  type Staff,
  type Track,
} from './composition'
import { keyAccidental, measureAtTick, resolvedPitch, signatureAt } from './signatures'

export const SNAP_CHOICES = [
  { ticks: 480, label: '1/4' },
  { ticks: 240, label: '1/8' },
  { ticks: 120, label: '1/16' },
  { ticks: 60, label: '1/32' },
] as const
export type SnapTicks = (typeof SNAP_CHOICES)[number]['ticks']
export const LOWEST_MIDI = 11 // C-flat0 is valid in existing files; no octave -1 spelling required.
export const HIGHEST_MIDI = 127
export type NoteEvent = Extract<ScoreEvent, { kind: 'note' }>
export interface RollNote {
  event: NoteEvent
  staffId: string
  clef: Staff['clef']
  midi: number
}
export interface NoteUpdate {
  id: string
  startTick?: number
  durationTicks?: number
  midi?: number
  staffId?: string
}
export type NewNoteStaff = 'auto' | 'treble' | 'bass'
export const snapTick = (tick: number, snap: SnapTicks): number => Math.round(tick / snap) * snap
/** Coarser grids must never lengthen a leftward resize or quantize a stationary edge. */
export function resizedDuration(original: number, delta: number, snap: SnapTicks): number {
  if (delta === 0) return original
  const target = Math.max(snap, snapTick(original + delta, snap))
  return delta < 0 ? Math.min(original, target) : Math.max(original, target)
}
export const midiName = (midi: number): string =>
  `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`
export const pitchName = (pitch: Pitch): string =>
  `${pitch.step}${pitch.accidental === 'n' ? '♮' : pitch.accidental}${pitch.octave}`

export function pianoNotes(score: Composition, trackId: string): RollNote[] {
  const track = score.tracks.find((track) => track.id === trackId)
  if (!track) throw new Error('Select a valid instrument.')
  return track.staves.flatMap((staff) =>
    staff.events.flatMap((event) =>
      event.kind === 'note'
        ? [
            {
              event,
              staffId: staff.id,
              clef: staff.clef,
              midi: pitchToMidi(resolvedPitch(score, staff, event.startTick, event.pitch)),
            },
          ]
        : [],
    ),
  )
}
export function defaultStaff(track: Track, midi: number, preference: NewNoteStaff = 'auto'): Staff {
  return (
    track.staves.find(
      (staff) =>
        staff.clef === (preference === 'auto' ? (midi >= 60 ? 'treble' : 'bass') : preference),
    ) ?? track.staves[0]!
  )
}

/** Prefer an existing spelling, then the active key, then sharps/flats matching the key. */
export function spellMidi(
  score: Composition,
  staff: Staff,
  tick: number,
  midi: number,
  preferred?: Pitch,
): Pitch {
  if (!Number.isInteger(midi) || midi < LOWEST_MIDI || midi > HIGHEST_MIDI)
    throw new Error('Supported pitches range from C-flat0 (MIDI 11) through G9 (MIDI 127).')
  if (preferred && pitchToMidi(resolvedPitch(score, staff, tick, preferred)) === midi)
    return { ...preferred }
  const key = signatureAt(score, measureAtTick(score, tick)).keySignature
  const candidates: Pitch[] = []
  for (const octave of [
    Math.floor(midi / 12) - 2,
    Math.floor(midi / 12) - 1,
    Math.floor(midi / 12),
  ]) {
    if (octave < 0 || octave > 9) continue
    for (const step of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const) {
      const natural = { step, octave, accidental: '' as const }
      const difference = midi - pitchToMidi(natural)
      if (Math.abs(difference) > 1) continue
      const accidental = difference === 1 ? '#' : difference === -1 ? 'b' : 'n'
      const explicit: Pitch = { ...natural, accidental }
      candidates.push(
        pitchToMidi(resolvedPitch(score, staff, tick, natural)) === midi ? natural : explicit,
      )
    }
  }
  const rank = (pitch: Pitch): number => {
    const alteration = midi - pitchToMidi({ ...pitch, accidental: '' })
    return (
      (preferred?.step === pitch.step && preferred.octave === pitch.octave ? -10 : 0) +
      (keyAccidental(key, pitch.step) === (alteration === 1 ? '#' : alteration === -1 ? 'b' : '')
        ? 0
        : 3) +
      (alteration === 0 ? 0 : 1) +
      (key.includes('b') || ['F', 'Dm', 'Gm', 'Cm', 'Fm'].includes(key)
        ? alteration === 1
          ? 1
          : 0
        : alteration === -1
          ? 1
          : 0)
    )
  }
  return candidates.sort((a, b) => rank(a) - rank(b))[0]!
}

/** Keep unedited MIDI pitches stable when edits alter accidental carry. */
function preserveSounds(
  score: Composition,
  desired: Map<string, number>,
  preferred: Map<string, Pitch>,
): Composition {
  const next = {
    ...score,
    tracks: score.tracks.map((track) => ({
      ...track,
      staves: track.staves.map((staff) => {
        const result: Staff = { ...staff, events: [] }
        for (const event of [...staff.events].sort((a, b) => a.startTick - b.startTick)) {
          if (event.kind !== 'note') {
            result.events.push(event)
            continue
          }
          const midi = desired.get(event.id)!
          result.events.push({
            ...event,
            pitch: spellMidi(
              score,
              result,
              event.startTick,
              midi,
              preferred.get(event.id) ?? event.pitch,
            ),
          })
        }
        return result
      }),
    })),
  }
  return parseComposition(next)
}
export function editPianoNotes(
  score: Composition,
  trackId: string,
  updates: NoteUpdate[],
): Composition {
  const track = score.tracks.find((track) => track.id === trackId)
  if (!track) throw new Error('Select a valid instrument.')
  const known = new Set(pianoNotes(score, trackId).map((note) => note.event.id))
  if (
    new Set(updates.map((item) => item.id)).size !== updates.length ||
    updates.some((item) => !known.has(item.id))
  )
    throw new Error('Select valid notes in the current instrument.')
  if (
    updates.some((item) => item.staffId && !track.staves.some((staff) => staff.id === item.staffId))
  )
    throw new Error('Notes must remain in their original instrument.')
  const changes = new Map(updates.map((item) => [item.id, item]))
  const desired = new Map<string, number>(),
    preferred = new Map<string, Pitch>()
  for (const part of score.tracks)
    for (const note of pianoNotes(score, part.id)) {
      const update = changes.get(note.event.id)
      desired.set(note.event.id, update?.midi ?? note.midi)
      preferred.set(note.event.id, note.event.pitch)
    }
  const next = {
    ...score,
    tracks: score.tracks.map((part) =>
      part.id !== trackId
        ? part
        : {
            ...part,
            staves: part.staves.map((staff) => ({
              ...staff,
              events: part.staves.flatMap((source) =>
                source.events.flatMap((event) => {
                  const update = changes.get(event.id)
                  if ((update?.staffId ?? source.id) !== staff.id) return []
                  return [
                    {
                      ...event,
                      ...(update?.startTick === undefined ? {} : { startTick: update.startTick }),
                      ...(update?.durationTicks === undefined
                        ? {}
                        : { durationTicks: update.durationTicks }),
                    },
                  ]
                }),
              ),
            })),
          },
    ),
  }
  return preserveSounds(next, desired, preferred)
}
export function insertPianoNote(
  score: Composition,
  trackId: string,
  startTick: number,
  midi: number,
  durationTicks: number,
  preference: NewNoteStaff = 'auto',
): { score: Composition; id: string; staffId: string } {
  const track = score.tracks.find((track) => track.id === trackId)
  if (!track) throw new Error('Select a valid instrument.')
  const staff = defaultStaff(track, midi, preference)
  const id = crypto.randomUUID()
  const desired = new Map<string, number>()
  for (const part of score.tracks)
    for (const note of pianoNotes(score, part.id)) desired.set(note.event.id, note.midi)
  desired.set(id, midi)
  const event: NoteEvent = {
    id,
    kind: 'note',
    startTick,
    durationTicks,
    pitch: spellMidi(score, staff, startTick, midi),
    velocity: 80,
  }
  const next = {
    ...score,
    tracks: score.tracks.map((part) =>
      part.id !== trackId
        ? part
        : {
            ...part,
            staves: part.staves.map((item) =>
              item.id !== staff.id ? item : { ...item, events: [...item.events, event] },
            ),
          },
    ),
  }
  return { score: preserveSounds(next, desired, new Map()), id, staffId: staff.id }
}
/** Explicitly select a chord/tie component before moving it as a group. */
export function linkedNotes(score: Composition, trackId: string, ids: string[]): string[] {
  const notes = pianoNotes(score, trackId)
  const selected = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    for (const note of notes)
      if (
        !selected.has(note.event.id) &&
        notes.some(
          (other) =>
            selected.has(other.event.id) &&
            ((other.staffId === note.staffId &&
              other.event.startTick === note.event.startTick &&
              other.event.durationTicks === note.event.durationTicks) ||
              other.event.tieTo === note.event.id ||
              note.event.tieTo === other.event.id),
        )
      ) {
        selected.add(note.event.id)
        changed = true
      }
  }
  return [...selected]
}
