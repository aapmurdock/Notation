import { describe, expect, it } from 'vitest'
import {
  createComposition,
  createExample,
  parseComposition,
  serializeComposition,
} from './composition'
import { changeSignature, history, recordEdit, undo, redo, toggleTies } from './editing'
import {
  editPianoNotes,
  insertPianoNote,
  pianoNotes,
  linkedNotes,
  snapTick,
  resizedDuration,
  spellMidi,
  SNAP_CHOICES,
} from './piano-roll'
import { measureStart, scoreEnd } from './signatures'

const part = (score: ReturnType<typeof createComposition>) => score.tracks[0]!.id

describe('shared piano-roll editing', () => {
  it('does not quantize stationary edges or reverse resize direction when the grid is coarser', () => {
    expect(resizedDuration(60, 0, 480)).toBe(60)
    expect(resizedDuration(60, -120, 480)).toBe(60)
    expect(resizedDuration(60, 240, 480)).toBe(480)
    expect(resizedDuration(600, 20, 480)).toBe(600)
    expect(resizedDuration(600, -20, 480)).toBe(480)
    expect(resizedDuration(60, -60, 60)).toBe(60)
  })
  it.each(SNAP_CHOICES)(
    'snaps exactly at $label without quantizing existing music',
    ({ ticks }) => {
      expect(snapTick(ticks * 2 + ticks * 0.4, ticks)).toBe(ticks * 2)
      const original = createExample()
      const snapshot = serializeComposition(original)
      snapTick(481, ticks)
      expect(serializeComposition(original)).toBe(snapshot)
    },
  )
  it('retains the lowest existing spelling C-flat0 and keeps edits within the supported range', () => {
    const score = createComposition()
    const created = insertPianoNote(score, part(score), 0, 11, 60)
    expect(pianoNotes(created.score, part(score))[0]).toMatchObject({
      midi: 11,
      event: { pitch: { step: 'C', octave: 0, accidental: 'b' } },
    })
    expect(() =>
      editPianoNotes(created.score, part(score), [{ id: created.id, midi: 10 }]),
    ).toThrow(/Supported pitches/)
  })
  it('uses chromatic pitch and predictable staff ownership, preserving IDs and velocity on edits', () => {
    const initial = createComposition()
    const inserted = insertPianoNote(initial, part(initial), 60, 61, 60)
    const note = pianoNotes(inserted.score, part(initial))[0]!
    expect(note).toMatchObject({
      midi: 61,
      clef: 'treble',
      event: { id: inserted.id, startTick: 60, durationTicks: 60, velocity: 80 },
    })
    const edited = editPianoNotes(inserted.score, part(initial), [
      { id: inserted.id, startTick: 240, durationTicks: 300, midi: 48 },
    ])
    expect(pianoNotes(edited, part(initial))[0]).toMatchObject({
      midi: 48,
      staffId: inserted.staffId,
      event: { id: inserted.id, startTick: 240, durationTicks: 300, velocity: 80 },
    })
    const bass = insertPianoNote(initial, part(initial), 0, 48, 480)
    expect(pianoNotes(bass.score, part(initial))[0]!.clef).toBe('bass')
    const corrected = editPianoNotes(bass.score, part(initial), [
      { id: bass.id, staffId: initial.tracks[0]!.staves[0]!.id },
    ])
    expect(pianoNotes(corrected, part(initial))[0]!.clef).toBe('treble')
    expect(pianoNotes(bass.score, part(initial))[0]!.clef).toBe('bass')
  })
  it('holds one canonical ID for arbitrary durations crossing multiple variable-meter barlines', () => {
    let score = changeSignature(createComposition(), 1, {
      timeSignature: { numerator: 6, denominator: 8 },
    })
    const created = insertPianoNote(score, part(score), 1860, 66, 1920)
    score = created.score
    expect(pianoNotes(score, part(score))).toHaveLength(1)
    expect(score.tracks[0]!.staves[0]!.events[0]).toMatchObject({
      id: created.id,
      startTick: 1860,
      durationTicks: 1920,
    })
    const saved = serializeComposition(score)
    expect(parseComposition(JSON.parse(saved))).toEqual(score)
    expect(measureStart(score, 2)).toBe(3360)
    expect(() =>
      editPianoNotes(score, part(score), [{ id: created.id, durationTicks: scoreEnd(score) }]),
    ).toThrow(/end of the score/)
    expect(serializeComposition(score)).toBe(saved)
  })
  it('preserves existing spelling when possible, follows key signatures, and pins unedited chromatic pitches', () => {
    let score = changeSignature(createComposition(), 0, { keySignature: 'G' })
    const staff = score.tracks[0]!.staves[0]!
    expect(spellMidi(score, staff, 0, 66)).toEqual({ step: 'F', octave: 4, accidental: '' })
    expect(spellMidi(score, staff, 0, 65)).toEqual({ step: 'F', octave: 4, accidental: 'n' })
    score = changeSignature(score, 0, { keySignature: 'Bb' })
    expect(spellMidi(score, staff, 0, 70)).toMatchObject({ step: 'B', octave: 4 })
    const first = insertPianoNote(score, part(score), 480, 65, 480)
    const second = insertPianoNote(first.score, part(score), 0, 66, 480)
    expect(pianoNotes(second.score, part(score)).map((note) => note.midi)).toEqual([66, 65])
    const moved = editPianoNotes(second.score, part(score), [{ id: second.id, startTick: 1920 }])
    expect(pianoNotes(moved, part(score)).find((note) => note.event.id === first.id)!.midi).toBe(65)
  })
  it('supports chord selection and atomic group moves; rejects unsupported overlaps without changing data', () => {
    const initial = createComposition()
    let inserted = insertPianoNote(initial, part(initial), 0, 60, 480)
    const first = inserted.id
    inserted = insertPianoNote(inserted.score, part(initial), 0, 64, 480)
    const second = inserted.id
    expect(linkedNotes(inserted.score, part(initial), [first])).toEqual([first, second])
    const snapshot = serializeComposition(inserted.score)
    expect(() =>
      editPianoNotes(inserted.score, part(initial), [{ id: first, startTick: 240 }]),
    ).toThrow(/overlapping voices/)
    expect(() =>
      editPianoNotes(inserted.score, part(initial), [{ id: first, durationTicks: 240 }]),
    ).toThrow(/overlapping voices/)
    expect(serializeComposition(inserted.score)).toBe(snapshot)
    const moved = editPianoNotes(
      inserted.score,
      part(initial),
      [first, second].map((id) => ({ id, startTick: 1920, durationTicks: 600 })),
    )
    expect(pianoNotes(moved, part(initial)).map((note) => note.event.startTick)).toEqual([
      1920, 1920,
    ])
  })
  it('retains explicit ties when a linked selection moves, rejects broken ties, and supports undo/redo', () => {
    const initial = createComposition()
    const first = insertPianoNote(initial, part(initial), 1440, 60, 480)
    const second = insertPianoNote(first.score, part(initial), 1920, 60, 480)
    const tied = toggleTies(second.score, [first.id])
    expect(linkedNotes(tied, part(initial), [first.id])).toEqual([first.id, second.id])
    expect(() => editPianoNotes(tied, part(initial), [{ id: first.id, midi: 62 }])).toThrow(/tie/)
    const moved = editPianoNotes(
      tied,
      part(initial),
      pianoNotes(tied, part(initial)).map((note) => ({
        id: note.event.id,
        startTick: note.event.startTick + 60,
        midi: 62,
      })),
    )
    expect(pianoNotes(moved, part(initial))[0]!.event.tieTo).toBe(second.id)
    const state = recordEdit(history(tied), moved)
    expect(undo(state).present).toEqual(tied)
    expect(redo(undo(state)).present).toEqual(moved)
  })
  it('migrates versions 1–3 without retiming, respelling, or losing IDs', () => {
    const score = createExample()
    const v3 = { ...score, schemaVersion: 3 }
    expect(parseComposition(v3)).toEqual(score)
    const v2 = { ...v3, schemaVersion: 2 }
    expect(parseComposition(v2)).toEqual(score)
    expect(() =>
      parseComposition({
        ...v3,
        tracks: [
          {
            ...score.tracks[0],
            staves: [
              {
                ...score.tracks[0]!.staves[0],
                events: [{ ...score.tracks[0]!.staves[0]!.events[0], startTick: 1860 }],
              },
              score.tracks[0]!.staves[1],
            ],
          },
        ],
      }),
    ).toThrow()
  })
})
