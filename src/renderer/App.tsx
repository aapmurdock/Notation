import { useEffect, useRef, useState } from 'react'
import {
  baseDuration,
  isDotted,
  createComposition,
  createExample,
  createTrack,
  deleteEvents,
  getStaff,
  insertEvent,
  nextFreeTick,
  parseComposition,
  pitchToMidi,
  removeLastEvent,
  type Composition,
  type Step,
  type Pitch,
  type DurationTicks,
} from '../shared/composition'
import { PianoRoll, type RollPreferences, type RollScroll } from './piano-roll/PianoRoll'
import {
  defaultStaff,
  editPianoNotes,
  insertPianoNote,
  pianoNotes,
  spellMidi,
  linkedNotes,
  type NoteUpdate,
} from '../shared/piano-roll'
import { ScoreView, type ScoreCursor } from './score/ScoreView'
import { durationChoices, NotationToolbar, type EntrySettings } from './NotationToolbar'
import { transposeStep } from './score/geometry'
import { PianoAudition } from './audio/PianoAudition'
import { SignatureEditor } from './SignatureEditor'
import {
  changeDuration,
  changePitch,
  changeSignature,
  updateEvents,
  toggleTies,
  history,
  recordEdit,
  undo,
  redo,
} from '../shared/editing'
import {
  measureAtTick,
  measureStart,
  measureTicks,
  scoreEnd,
  signatureAt,
  resolvedPitch,
  type KeySignature,
  type TimeSignature,
} from '../shared/signatures'

function initialCursor(score: Composition): ScoreCursor {
  const track = score.tracks[0]!
  const staff = track.staves[0]!
  const event = staff.events[0]
  return {
    trackId: track.id,
    staffId: staff.id,
    tick: event?.startTick ?? 0,
    pitch:
      event?.kind === 'note'
        ? event.pitch
        : { step: 'C', octave: staff.clef === 'bass' ? 3 : 4, accidental: '' },
    eventId: event?.id,
  }
}

const instruments = [
  { name: 'Piano', clef: 'treble', program: 0 },
  { name: 'Violin', clef: 'treble', program: 40 },
  { name: 'Cello', clef: 'bass', program: 42 },
  { name: 'Flute', clef: 'treble', program: 73 },
] as const

export function App() {
  const [score, setScore] = useState<Composition>(() => parseComposition(createExample()))
  const editHistory = useRef(history(score))
  const savedDocument = useRef(JSON.stringify(score))
  const [cursor, setCursor] = useState<ScoreCursor>(() => initialCursor(score))
  const [settings, setSettings] = useState<EntrySettings>({
    duration: 480,
    rest: false,
    accidental: '',
    mode: 'write',
  })
  const [view, setView] = useState<'notation' | 'piano-roll'>('notation')
  const [rollPreferences, setRollPreferences] = useState<RollPreferences>({
    snap: 120,
    quarterWidth: 96,
    rowHeight: 18,
    tool: 'draw',
    newStaff: 'auto',
  })
  const rollScroll = useRef<Record<string, RollScroll>>({})
  const viewScroll = useRef({ notation: 0, 'piano-roll': 0 })
  function switchView(next: typeof view): void {
    viewScroll.current[view] = window.scrollY
    audition.current?.stop()
    if (next === 'piano-roll') {
      const notes = new Set(pianoNotes(score, cursor.trackId).map((note) => note.event.id))
      const ids = selection.filter((id) => notes.has(id))
      if (ids.length !== selection.length)
        setCursor((previous) => ({ ...previous, eventId: ids[0], selectedIds: ids }))
    }
    setView(next)
    requestAnimationFrame(() => window.scrollTo(0, viewScroll.current[next]))
  }
  const selectedTrackId = cursor.trackId
  const selectedMeasure = Math.min(score.measureCount - 1, measureAtTick(score, cursor.tick))
  const [dirty, setDirty] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [message, setMessage] = useState('Select a measure to start composing.')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [instrument, setInstrument] = useState(0)
  const editor = useRef<HTMLDivElement>(null)
  const audition = useRef<PianoAudition | null>(null)
  const [audioUnavailable, setAudioUnavailable] = useState(false)
  const [auditionEnabled, setAuditionEnabled] = useState(true)
  useEffect(() => {
    const piano = new PianoAudition(undefined, () => setAudioUnavailable(true))
    audition.current = piano
    return () => {
      piano.dispose()
      audition.current = null
    }
  }, [])
  function previewPitch(staffId: string, tick: number, pitch: Pitch, eventId?: string): void {
    const staff = score.tracks
      .flatMap((track) => track.staves)
      .find((staff) => staff.id === staffId)
    if (auditionEnabled && staff)
      audition.current?.play(pitchToMidi(resolvedPitch(score, staff, tick, pitch, eventId)))
  }
  const selection = cursor.selectedIds ?? (cursor.eventId ? [cursor.eventId] : [])
  const entryDuration = (
    settings.dotted ? settings.duration * 1.5 : settings.duration
  ) as DurationTicks
  function applyHistory(direction: 'undo' | 'redo'): void {
    if (busy) return
    const next = direction === 'undo' ? undo(editHistory.current) : redo(editHistory.current)
    if (next === editHistory.current) return
    editHistory.current = next
    setScore(next.present)
    setCursor((previous) => {
      const entries = next.present.tracks.flatMap((track) =>
        track.staves.flatMap((staff) => staff.events.map((event) => ({ track, staff, event }))),
      )
      const ids = (previous.selectedIds ?? (previous.eventId ? [previous.eventId] : [])).filter(
        (id) => entries.some((item) => item.event.id === id),
      )
      const active =
        entries.find((item) => item.event.id === previous.eventId) ??
        entries.find((item) => ids.includes(item.event.id))
      if (active)
        return {
          trackId: active.track.id,
          staffId: active.staff.id,
          tick: active.event.startTick,
          pitch: active.event.kind === 'note' ? active.event.pitch : previous.pitch,
          eventId: active.event.id,
          selectedIds: ids,
        }
      return next.present.tracks.some(
        (track) =>
          track.id === previous.trackId &&
          track.staves.some((staff) => staff.id === previous.staffId),
      )
        ? {
            ...previous,
            tick: Math.min(previous.tick, scoreEnd(next.present)),
            eventId: undefined,
            selectedIds: undefined,
          }
        : initialCursor(next.present)
    })
    setDirty(JSON.stringify(next.present) !== savedDocument.current)
    setError('')
    setMessage(direction === 'undo' ? 'Edit undone.' : 'Edit redone.')
    audition.current?.stop()
  }
  function handleHistoryKey(event: React.KeyboardEvent): void {
    if (
      event.defaultPrevented ||
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      (event.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]')
    )
      return
    const key = event.key.toLowerCase()
    if (key === 'z' || key === 'y') {
      event.preventDefault()
      applyHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo')
    }
  }
  const selectedTrack = score.tracks.find((track) => track.id === selectedTrackId)!
  const selectedStaff = getStaff(score, cursor.trackId, cursor.staffId)
  const selectedEvents = selectedStaff.events.filter(
    (event) => measureAtTick(score, event.startTick) === selectedMeasure,
  )
  const notes = score.tracks
    .flatMap((track) => track.staves.flatMap((staff) => staff.events))
    .filter((event) => event.kind === 'note').length

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${score.title} — Notation`
    window.notation?.setDocumentDirty(dirty)
  }, [dirty, score.title])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent): void => {
      // Electron's main process owns the native close confirmation.
      if (dirty && !window.notation) event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  function change(next: Composition): boolean {
    try {
      const validated = parseComposition(next)
      editHistory.current = recordEdit(editHistory.current, validated)
      setScore(validated)
      setDirty(JSON.stringify(validated) !== savedDocument.current)
      setError('')
      setMessage('Composition updated.')
      return true
    } catch (cause) {
      showError(cause)
      return false
    }
  }
  function applySignature(
    measure: number,
    next: { keySignature?: KeySignature; timeSignature?: TimeSignature },
  ): void {
    if (busy) return
    const edited = changeSignature(score, measure, next)
    if (change(edited))
      setCursor((previous) => ({
        ...previous,
        eventId: undefined,
        selectedIds: undefined,
        tick: measureStart(edited, measure),
      }))
  }
  function showError(cause: unknown): void {
    setError(cause instanceof Error ? cause.message : 'Something went wrong.')
  }
  function replace(next: Composition, name: string | null = null): void {
    next = parseComposition(next)
    const first = next.tracks[0]!.staves[0]!.events[0]
    setSettings({
      duration:
        first &&
        durationChoices.some((choice) => choice.ticks === baseDuration(first.durationTicks))
          ? baseDuration(first.durationTicks)
          : 480,
      dotted: first ? isDotted(first.durationTicks) : false,
      accidental: first?.kind === 'note' ? first.pitch.accidental : '',
      chord: false,
      rest: false,
      mode: 'write',
    })
    editHistory.current = history(next)
    savedDocument.current = JSON.stringify(next)
    setScore(next)
    rollScroll.current = {}
    audition.current?.stop()
    setCursor(initialCursor(next))
    setDirty(false)
    setFileName(name)
    setError('')
  }
  function canReplace(): boolean {
    return !dirty || window.confirm('Discard unsaved changes to this composition?')
  }
  async function openScore(): Promise<void> {
    if (!window.notation || !canReplace()) return
    setBusy(true)
    setError('')
    try {
      const result = await window.notation.openScore()
      if (result.status === 'ok') {
        replace(parseComposition(result.value.score), result.value.fileName)
        setMessage(`Opened ${result.value.fileName}.`)
      } else if (result.status === 'error') setError(result.message)
    } catch (cause) {
      showError(cause)
    } finally {
      setBusy(false)
    }
  }
  async function saveScore(): Promise<void> {
    if (!window.notation) return
    setBusy(true)
    setError('')
    try {
      const result = await window.notation.saveScore(score)
      if (result.status === 'ok') {
        savedDocument.current = JSON.stringify(score)
        setDirty(false)
        setFileName(result.value.fileName)
        setMessage(`Saved ${result.value.fileName}.`)
      } else if (result.status === 'error') setError(result.message)
    } catch (cause) {
      showError(cause)
    } finally {
      setBusy(false)
    }
  }
  function selectStaff(trackId: string, staffId: string): void {
    const staff = getStaff(score, trackId, staffId)
    const start = measureStart(score, selectedMeasure)
    const tick = Math.min(
      nextFreeTick(staff, start),
      start + measureTicks(score, selectedMeasure) - 60,
    )
    setCursor({
      trackId,
      staffId,
      tick,
      pitch: { step: 'C', octave: staff.clef === 'bass' ? 3 : 4, accidental: settings.accidental },
    })
    setError('')
    editor.current
      ?.querySelector<SVGSVGElement>(view === 'notation' ? '.score-interaction' : '.roll-grid')
      ?.focus({ preventScroll: true })
  }
  function enter(at = cursor, rest = settings.rest): void {
    if (busy) return
    try {
      const pitch = { ...at.pitch, accidental: settings.accidental }
      const input = rest
        ? { kind: 'rest' as const, durationTicks: entryDuration }
        : { kind: 'note' as const, durationTicks: entryDuration, pitch }
      const next = insertEvent(score, at.trackId, at.staffId, at.tick, input, !!settings.chord)
      change(next)
      if (!rest) previewPitch(at.staffId, at.tick, pitch)
      setCursor({
        ...at,
        pitch,
        eventId: undefined,
        selectedIds: undefined,
        tick:
          settings.chord && !rest
            ? at.tick
            : nextFreeTick(getStaff(next, at.trackId, at.staffId), at.tick + entryDuration),
      })
      setMessage(
        `Added ${rest ? 'rest' : pitch.step + pitch.accidental + pitch.octave}. ${settings.chord && !rest ? 'Add another chord tone or move to the next beat.' : 'Insertion position advanced.'}`,
      )
    } catch (cause) {
      showError(cause)
    }
  }
  function removeSelected(): void {
    if (!selection.length || busy) return
    change(deleteEvents(score, selection))
    setCursor({ ...cursor, eventId: undefined, selectedIds: undefined })
    setMessage('Entry deleted. Other music stays at its original time.')
  }
  function entrySettings(next: EntrySettings, field?: keyof EntrySettings): void {
    if (busy) return
    try {
      let edited = score
      if (selection.length) {
        if (
          field === 'duration' ||
          field === 'dotted' ||
          next.duration !== settings.duration ||
          !!next.dotted !== !!settings.dotted
        )
          edited =
            view === 'piano-roll'
              ? editPianoNotes(
                  edited,
                  selectedTrackId,
                  selection.map((id) => ({
                    id,
                    durationTicks: next.duration * (next.dotted ? 1.5 : 1),
                  })),
                )
              : changeDuration(edited, selection, next.duration * (next.dotted ? 1.5 : 1))
        if (field === 'accidental' || next.accidental !== settings.accidental)
          edited = updateEvents(edited, selection, (event) =>
            event.kind === 'note'
              ? { ...event, pitch: { ...event.pitch, accidental: next.accidental } }
              : event,
          )
        if (edited !== score && !change(edited)) return
      }
      setSettings(next)
      if (!selection.length)
        setCursor((previous) => ({
          ...previous,
          pitch: { ...previous.pitch, accidental: next.accidental },
        }))
      else if (edited !== score && next.accidental !== settings.accidental) {
        const note = edited.tracks
          .flatMap((track) => track.staves)
          .flatMap((staff) => staff.events)
          .find((event) => selection.includes(event.id))
        if (note?.kind === 'note') {
          setCursor((previous) => ({ ...previous, pitch: note.pitch }))
          previewPitch(cursor.staffId, note.startTick, note.pitch, note.id)
        }
      }
    } catch (cause) {
      showError(cause)
    }
  }
  function tieSelected(): void {
    try {
      change(toggleTies(score, selection))
    } catch (cause) {
      showError(cause)
    }
  }
  function handleScoreKey(event: React.KeyboardEvent): void {
    const target = event.target as HTMLElement
    if (
      view === 'piano-roll' ||
      busy ||
      target.closest('input, select, textarea, [contenteditable="true"]')
    )
      return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase()
    const choice = durationChoices.find((choice) => choice.key === key)
    if (choice) {
      event.preventDefault()
      entrySettings(
        {
          ...settings,
          duration: choice.ticks,
          dotted: choice.ticks === 60 ? false : settings.dotted,
          mode: 'write',
        },
        'duration',
      )
      return
    }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault()
      removeSelected()
      return
    }
    if ((key === '.' && settings.duration !== 60) || key === 'h') {
      event.preventDefault()
      entrySettings(
        key === '.'
          ? { ...settings, dotted: !settings.dotted }
          : { ...settings, chord: !settings.chord, rest: false },
      )
      return
    }
    if (key === 't') {
      event.preventDefault()
      tieSelected()
      return
    }
    if (key === 'r') {
      event.preventDefault()
      entrySettings({ ...settings, rest: !settings.rest })
      return
    }
    if (key === '+' || key === '-' || key === '=') {
      event.preventDefault()
      entrySettings({ ...settings, accidental: key === '+' ? '#' : key === '-' ? 'b' : 'n' })
      return
    }
    if (key === 'n' || key === 'escape') {
      event.preventDefault()
      entrySettings({ ...settings, mode: key === 'n' ? 'write' : 'select' })
      setCursor({
        ...cursor,
        eventId: undefined,
        selectedIds: undefined,
        tick: key === 'n' ? nextFreeTick(selectedStaff, cursor.tick) : cursor.tick,
      })
      return
    }
    if (key === 'arrowup' || key === 'arrowdown') {
      event.preventDefault()
      const pitch = transposeStep(cursor.pitch, key === 'arrowup' ? 1 : -1)
      if (
        cursor.eventId &&
        selectedStaff.events.find((item) => item.id === cursor.eventId)?.kind === 'note' &&
        selection.length === 1
      ) {
        try {
          if (change(changePitch(score, cursor.eventId, pitch))) {
            setCursor({ ...cursor, pitch })
            previewPitch(cursor.staffId, cursor.tick, pitch, cursor.eventId)
          }
        } catch (cause) {
          showError(cause)
        }
      } else setCursor({ ...cursor, eventId: undefined, selectedIds: undefined, pitch })
      return
    }
    if (key === 'arrowleft' || key === 'arrowright') {
      event.preventDefault()
      setCursor({
        ...cursor,
        eventId: undefined,
        selectedIds: undefined,
        tick: Math.max(
          0,
          Math.min(scoreEnd(score), cursor.tick + (key === 'arrowleft' ? -120 : 120)),
        ),
      })
      return
    }
    if (/^[a-g]$/.test(key)) {
      event.preventDefault()
      entrySettings({ ...settings, rest: false, mode: 'write' })
      enter({ ...cursor, pitch: { ...cursor.pitch, step: key.toUpperCase() as Step } }, false)
      return
    }
    if (key === '0') {
      event.preventDefault()
      enter(cursor, true)
      return
    }
    if (key === 'enter' && target.tagName.toLowerCase() !== 'button') {
      event.preventDefault()
      enter()
    }
  }

  function selectRoll(ids: string[], at?: { tick: number; midi: number }, document = score): void {
    const part = document.tracks.find((part) => part.id === selectedTrackId)!
    const note = pianoNotes(document, selectedTrackId).find((note) => ids.includes(note.event.id))
    if (note) {
      setCursor({
        trackId: selectedTrackId,
        staffId: note.staffId,
        tick: note.event.startTick,
        pitch: note.event.pitch,
        eventId: note.event.id,
        selectedIds: ids,
      })
      const base = baseDuration(note.event.durationTicks)
      // A sustained roll duration may need several notation glyphs. Keep the last
      // insertion duration until the composer explicitly chooses a replacement.
      if (durationChoices.some((choice) => choice.ticks === base))
        setSettings((previous) => ({
          ...previous,
          duration: base,
          dotted: isDotted(note.event.durationTicks),
          accidental: note.event.pitch.accidental,
        }))
    } else if (at) {
      const staff = defaultStaff(part, at.midi, rollPreferences.newStaff)
      setCursor({
        trackId: selectedTrackId,
        staffId: staff.id,
        tick: at.tick,
        pitch: spellMidi(document, staff, at.tick, at.midi),
      })
    } else setCursor((previous) => ({ ...previous, eventId: undefined, selectedIds: undefined }))
    setError('')
  }

  return (
    <div className="app-shell" onKeyDown={handleHistoryKey}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ♮
          </span>
          <div>
            Notation<small>A SPACE TO COMPOSE</small>
          </div>
        </div>
        <span className="milestone">
          Milestone 3A <span>One composition, two views</span>
        </span>
        <nav aria-label="File actions">
          <button
            disabled={busy}
            onClick={() => {
              if (canReplace()) {
                replace(createComposition())
                setMessage('New composition created.')
              }
            }}
          >
            New score
          </button>
          <button disabled={busy || !window.notation} onClick={() => void openScore()}>
            Open
          </button>
          <button
            className="primary"
            disabled={busy || !window.notation}
            onClick={() => void saveScore()}
          >
            {busy ? 'Working…' : 'Save score'}
          </button>
        </nav>
      </header>
      <div className="workspace">
        <aside className="sidebar" aria-label="Composition tools">
          <section className="tool-section">
            <p className="eyebrow">YOUR COMPOSITION</p>
            <label htmlFor="title">Title</label>
            <input
              id="title"
              key={`${score.id}-${score.title}`}
              defaultValue={score.title}
              maxLength={120}
              disabled={busy}
              onBlur={(event) => {
                if (event.target.value.trim() && event.target.value !== score.title)
                  change({ ...score, title: event.target.value.trim() })
                event.target.value = event.target.value.trim() || score.title
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
            <div className="field-row">
              <label>
                Tempo <span className="unit">BPM</span>
                <input
                  aria-label="Tempo"
                  type="number"
                  min={30}
                  max={240}
                  defaultValue={score.tempoBpm}
                  key={`${score.id}-${score.tempoBpm}`}
                  disabled={busy}
                  onBlur={(event) => {
                    if (Number(event.target.value) !== score.tempoBpm)
                      change({ ...score, tempoBpm: Number(event.target.value) })
                    event.target.value = String(
                      Number.isInteger(Number(event.target.value)) &&
                        Number(event.target.value) >= 30 &&
                        Number(event.target.value) <= 240
                        ? Number(event.target.value)
                        : score.tempoBpm,
                    )
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              </label>
            </div>
            <SignatureEditor
              disabled={busy}
              score={score}
              measure={selectedMeasure}
              onChange={applySignature}
            />
          </section>
          <section className="tool-section">
            <div className="section-heading">
              <h2>Parts</h2>
              <span>{score.tracks.length} / 16</span>
            </div>
            <div className="part-list" aria-label="Parts">
              {score.tracks.map((track, index) => (
                <button
                  key={track.id}
                  className={`part-button ${track.id === selectedTrackId ? 'active' : ''}`}
                  disabled={busy}
                  aria-pressed={track.id === selectedTrackId}
                  onClick={() => selectStaff(track.id, track.staves[0]!.id)}
                >
                  <span className="part-number">{String(index + 1).padStart(2, '0')}</span>
                  <span>
                    {track.name}
                    <small>
                      {track.staves.length === 2
                        ? 'Piano grand staff'
                        : `${track.staves[0]!.clef} clef`}
                    </small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
            <div className="add-part">
              <select
                aria-label="New part instrument"
                value={instrument}
                disabled={busy}
                onChange={(event) => setInstrument(Number(event.target.value))}
              >
                {instruments.map((item, index) => (
                  <option value={index} key={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || score.tracks.length >= 16}
                onClick={() => {
                  const item = instruments[instrument]!
                  const count = score.tracks.filter((track) =>
                    track.name.startsWith(item.name),
                  ).length
                  const track = createTrack(
                    `${item.name}${count ? ` ${count + 1}` : ''}`,
                    item.clef,
                    item.program,
                  )
                  change({ ...score, tracks: [...score.tracks, track] })
                  setCursor({
                    trackId: track.id,
                    staffId: track.staves[0]!.id,
                    tick: 0,
                    pitch: { step: 'C', octave: 4, accidental: '' },
                  })
                }}
              >
                + Add part
              </button>
            </div>
          </section>
          <section className="tool-section note-tools">
            <div className="section-heading">
              <h2>Editing</h2>
              <span>BAR {selectedMeasure + 1}</span>
            </div>
            <p className="help">
              Click to write and hear a pitch. Drag a note vertically to repitch; Escape cancels.
              Shift-click adds to the selection. Duration and accidental buttons edit selected
              entries.
            </p>
            <dl className="keyboard-guide">
              <dt>1–6</dt>
              <dd>Whole → thirty-second</dd>
              <dt>A–G</dt>
              <dd>Enter pitch, advance</dd>
              <dt>↑ / ↓</dt>
              <dd>Move pitch</dd>
              <dt>← / →</dt>
              <dd>Move by a sixteenth</dd>
              <dt>Enter / 0</dt>
              <dd>Enter note / rest</dd>
              <dt>Delete</dt>
              <dd>Remove selection</dd>
            </dl>
          </section>
          <div className="sidebar-note">
            <strong>A continuous musical workspace.</strong>
            <p>
              Click signatures on the staff to edit them. Use Chord to keep the beat while adding
              tones. MIDI recording and complete playback begin in later milestones.
            </p>
          </div>
        </aside>
        <main ref={editor} onKeyDown={handleScoreKey}>
          <div className="workspace-toolbar">
            <div>
              <span className="eyebrow">SCORE VIEW</span>
              <p>
                {score.tracks.length} {score.tracks.length === 1 ? 'part' : 'parts'} <span>·</span>{' '}
                {score.measureCount} measures <span>·</span> {notes} notes
              </p>
            </div>
            <div className="toolbar-actions">
              <button
                disabled={busy}
                onClick={() => {
                  if (canReplace()) {
                    replace(createExample())
                    setMessage('Example melody loaded.')
                  }
                }}
              >
                Load example
              </button>
              <button
                disabled={busy || score.measureCount >= 64}
                onClick={() => {
                  change({ ...score, measureCount: score.measureCount + 1 })
                  setCursor({
                    ...cursor,
                    tick: scoreEnd(score),
                    eventId: undefined,
                  })
                }}
              >
                + Add measure
              </button>
            </div>
          </div>
          {!window.notation && (
            <p className="browser-notice">
              Browser preview · Launch the desktop app to open and save score files.
            </p>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <div
            className="view-tabs"
            role="tablist"
            aria-label="Composition view"
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                event.stopPropagation()
                const next =
                  event.key === 'Home'
                    ? 'notation'
                    : event.key === 'End'
                      ? 'piano-roll'
                      : view === 'notation'
                        ? 'piano-roll'
                        : 'notation'
                switchView(next)
                document
                  .getElementById(next === 'notation' ? 'notation-tab' : 'roll-tab')
                  ?.focus({ preventScroll: true })
              }
            }}
          >
            <button
              id="notation-tab"
              role="tab"
              aria-selected={view === 'notation'}
              aria-controls="notation-panel"
              onClick={() => switchView('notation')}
            >
              Notation
            </button>
            <button
              id="roll-tab"
              role="tab"
              aria-selected={view === 'piano-roll'}
              aria-controls="roll-panel"
              onClick={() => switchView('piano-roll')}
            >
              Piano roll
            </button>
          </div>
          <div className="entry-bar">
            <NotationToolbar
              settings={settings}
              disabled={busy}
              pianoRoll={view === 'piano-roll'}
              onChange={entrySettings}
            />
            <div className="entry-commands">
              <button
                aria-pressed={auditionEnabled}
                onClick={() => {
                  setAuditionEnabled(!auditionEnabled)
                  audition.current?.stop()
                }}
              >
                Audition {auditionEnabled ? 'on' : 'off'}
              </button>
              {audioUnavailable && (
                <span aria-live="polite">Audio unavailable. Check the output device.</span>
              )}
              <button
                disabled={busy || !editHistory.current.past.length}
                onClick={() => applyHistory('undo')}
              >
                Undo
              </button>
              <button
                disabled={busy || !editHistory.current.future.length}
                onClick={() => applyHistory('redo')}
              >
                Redo
              </button>
              {view === 'notation' && (
                <button
                  disabled={busy || !selection.length}
                  onClick={() =>
                    setCursor((previous) => ({
                      ...previous,
                      selectedIds: linkedNotes(score, selectedTrackId, selection),
                    }))
                  }
                >
                  Select chord / ties
                </button>
              )}
              <button disabled={busy || !selection.length} onClick={tieSelected}>
                Toggle tie
              </button>
              {view === 'notation' && (
                <button disabled={busy} onClick={() => enter()}>
                  {settings.rest ? 'Insert rest' : 'Enter note'}
                </button>
              )}
              <button disabled={busy || !selection.length} onClick={removeSelected}>
                Delete selected
              </button>
              {view === 'notation' && (
                <button
                  disabled={busy || selectedEvents.length === 0}
                  onClick={() => {
                    const last = selectedEvents.at(-1)!
                    change(removeLastEvent(score, cursor.trackId, selectedMeasure, cursor.staffId))
                    setCursor({
                      ...cursor,
                      tick: last.startTick,
                      eventId: undefined,
                      selectedIds: undefined,
                    })
                  }}
                >
                  Remove last entry
                </button>
              )}
            </div>
            <p className="cursor-status" aria-live="polite">
              {selectedTrack.name} · {selectedStaff.clef} · Measure {selectedMeasure + 1}, beat{' '}
              {(cursor.tick - measureStart(score, selectedMeasure)) /
                (1920 / signatureAt(score, selectedMeasure).timeSignature.denominator) +
                1}
              {cursor.tick === scoreEnd(score) ? ' · End of score' : ''}
              {cursor.eventId
                ? ` · ${selection.length} selected`
                : ` · ${cursor.pitch.step}${cursor.pitch.accidental}${cursor.pitch.octave}`}
            </p>
          </div>
          {view === 'piano-roll' ? (
            <div id="roll-panel" role="tabpanel" aria-labelledby="roll-tab">
              <PianoRoll
                key={selectedTrackId}
                score={score}
                trackId={selectedTrackId}
                cursor={cursor}
                selection={selection}
                settings={settings}
                preferences={rollPreferences}
                disabled={busy}
                initialScroll={rollScroll.current[selectedTrackId]}
                onScroll={(position) => {
                  rollScroll.current[selectedTrackId] = position
                }}
                onPreferences={setRollPreferences}
                onSelect={(ids, at) => selectRoll(ids, at)}
                onInsert={(tick, midi, duration, staff) => {
                  const result = insertPianoNote(
                    score,
                    selectedTrackId,
                    tick,
                    midi,
                    duration,
                    staff,
                  )
                  if (!change(result.score)) throw new Error('Unable to insert the note.')
                  selectRoll([result.id], undefined, result.score)
                }}
                onEdit={(updates: NoteUpdate[]) => {
                  const edited = editPianoNotes(score, selectedTrackId, updates)
                  if (!change(edited)) throw new Error('Unable to edit the notes.')
                  selectRoll(selection, undefined, edited)
                }}
                onDelete={removeSelected}
                onSettings={entrySettings}
                onAudition={(midi) => {
                  if (auditionEnabled && midi >= 11 && midi <= 127) audition.current?.play(midi)
                }}
                onStopAudition={() => audition.current?.stop()}
              />
            </div>
          ) : (
            <div id="notation-panel" role="tabpanel" aria-labelledby="notation-tab">
              <ScoreView
                score={score}
                cursor={cursor}
                settings={settings}
                disabled={busy}
                onSelect={(next) => {
                  if (!busy) {
                    setCursor(next)
                    const selected = getStaff(score, next.trackId, next.staffId).events.find(
                      (event) => event.id === next.eventId,
                    )
                    if (selected)
                      setSettings((previous) => ({
                        ...previous,
                        duration: durationChoices.some(
                          (choice) => choice.ticks === baseDuration(selected.durationTicks),
                        )
                          ? baseDuration(selected.durationTicks)
                          : previous.duration,
                        dotted: isDotted(selected.durationTicks),
                        accidental:
                          selected.kind === 'note'
                            ? selected.pitch.accidental
                            : previous.accidental,
                      }))
                    setError('')
                  }
                }}
                onSignatureChange={applySignature}
                onPitchChange={(eventId, staffId, pitch) => {
                  if (busy) return
                  try {
                    if (change(changePitch(score, eventId, pitch)))
                      setCursor((previous) => ({ ...previous, staffId, pitch }))
                  } catch (cause) {
                    showError(cause)
                  }
                }}
                onAudition={previewPitch}
                onStopAudition={() => audition.current?.stop()}
                onInsert={enter}
                onSettings={entrySettings}
              />
            </div>
          )}
        </main>
      </div>
      <footer className="status-bar">
        <span className={`status-dot ${dirty ? 'unsaved' : ''}`} />
        <span role="status">{message}</span>
        <span className="file-status">
          {dirty ? 'Unsaved changes' : (fileName ?? 'Not saved to disk')}
        </span>
      </footer>
    </div>
  )
}
