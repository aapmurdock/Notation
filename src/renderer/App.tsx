import { useEffect, useRef, useState } from 'react'
import {
  createComposition,
  createExample,
  createTrack,
  deleteEvent,
  getStaff,
  insertEvent,
  nextFreeTick,
  parseComposition,
  removeLastEvent,
  ticksPerMeasure,
  type Composition,
  type Step,
} from '../shared/composition'
import { ScoreView, type ScoreCursor } from './score/ScoreView'
import { durationChoices, NotationToolbar, type EntrySettings } from './NotationToolbar'
import { transposeStep } from './score/geometry'

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
  const [score, setScore] = useState<Composition>(createExample)
  const [cursor, setCursor] = useState<ScoreCursor>(() => initialCursor(score))
  const [settings, setSettings] = useState<EntrySettings>({
    duration: 480,
    rest: false,
    accidental: '',
    mode: 'write',
  })
  const selectedTrackId = cursor.trackId
  const selectedMeasure = Math.min(
    score.measureCount - 1,
    Math.floor(cursor.tick / ticksPerMeasure(score)),
  )
  const [dirty, setDirty] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [message, setMessage] = useState('Select a measure to start composing.')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [instrument, setInstrument] = useState(0)
  const editor = useRef<HTMLDivElement>(null)
  const selectedTrack = score.tracks.find((track) => track.id === selectedTrackId)!
  const selectedStaff = getStaff(score, cursor.trackId, cursor.staffId)
  const selectedEvents = selectedStaff.events.filter(
    (event) => Math.floor(event.startTick / ticksPerMeasure(score)) === selectedMeasure,
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

  function change(next: Composition): void {
    try {
      setScore(parseComposition(next))
      setDirty(true)
      setError('')
      setMessage('Composition updated.')
    } catch (cause) {
      showError(cause)
    }
  }
  function showError(cause: unknown): void {
    setError(cause instanceof Error ? cause.message : 'Something went wrong.')
  }
  function replace(next: Composition, name: string | null = null): void {
    setScore(next)
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
    const start = selectedMeasure * ticksPerMeasure(score)
    const tick = Math.min(nextFreeTick(staff, start), start + ticksPerMeasure(score) - 120)
    setCursor({
      trackId,
      staffId,
      tick,
      pitch: { step: 'C', octave: staff.clef === 'bass' ? 3 : 4, accidental: settings.accidental },
    })
    setError('')
    editor.current?.querySelector<SVGSVGElement>('.score-interaction')?.focus()
  }
  function enter(at = cursor, rest = settings.rest): void {
    if (busy) return
    try {
      const pitch = { ...at.pitch, accidental: settings.accidental }
      const input = rest
        ? { kind: 'rest' as const, durationTicks: settings.duration }
        : { kind: 'note' as const, durationTicks: settings.duration, pitch }
      const next = insertEvent(score, at.trackId, at.staffId, at.tick, input)
      change(next)
      setCursor({
        ...at,
        pitch,
        eventId: undefined,
        tick: nextFreeTick(getStaff(next, at.trackId, at.staffId), at.tick + settings.duration),
      })
      setMessage(
        `Added ${rest ? 'rest' : pitch.step + pitch.accidental + pitch.octave}. Insertion position advanced.`,
      )
    } catch (cause) {
      showError(cause)
    }
  }
  function removeSelected(): void {
    if (!cursor.eventId || busy) return
    change(deleteEvent(score, cursor.staffId, cursor.eventId))
    setCursor({ ...cursor, eventId: undefined })
    setMessage('Entry deleted. Other music stays at its original time.')
  }
  function entrySettings(next: EntrySettings): void {
    setSettings(next)
    setCursor((previous) => ({
      ...previous,
      pitch: { ...previous.pitch, accidental: next.accidental },
    }))
  }
  function handleScoreKey(event: React.KeyboardEvent): void {
    const target = event.target as HTMLElement
    if (busy || target.closest('input, select, textarea, [contenteditable="true"]')) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase()
    const choice = durationChoices.find((choice) => choice.key === key)
    if (choice) {
      event.preventDefault()
      entrySettings({ ...settings, duration: choice.ticks, mode: 'write' })
      return
    }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault()
      removeSelected()
      return
    }
    if (key === 'r') {
      event.preventDefault()
      entrySettings({ ...settings, rest: !settings.rest })
      return
    }
    if (key === '+' || key === '-' || key === '=') {
      event.preventDefault()
      entrySettings({ ...settings, accidental: key === '+' ? '#' : key === '-' ? 'b' : '' })
      return
    }
    if (key === 'n' || key === 'escape') {
      event.preventDefault()
      entrySettings({ ...settings, mode: key === 'n' ? 'write' : 'select' })
      if (key === 'escape') setCursor({ ...cursor, eventId: undefined })
      return
    }
    if (key === 'arrowup' || key === 'arrowdown') {
      event.preventDefault()
      setCursor({
        ...cursor,
        eventId: undefined,
        pitch: transposeStep(cursor.pitch, key === 'arrowup' ? 1 : -1),
      })
      return
    }
    if (key === 'arrowleft' || key === 'arrowright') {
      event.preventDefault()
      setCursor({
        ...cursor,
        eventId: undefined,
        tick: Math.max(
          0,
          Math.min(
            score.measureCount * ticksPerMeasure(score),
            cursor.tick + (key === 'arrowleft' ? -120 : 120),
          ),
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

  return (
    <div className="app-shell">
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
          Milestone 2A <span>Write directly on the score</span>
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
              key={score.id}
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
              <div className="signature">
                <span>Time / Key</span>
                <strong>
                  {score.timeSignature.numerator}/4 <small>C major</small>
                </strong>
              </div>
            </div>
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
              <h2>Active staff</h2>
              <span>BAR {selectedMeasure + 1}</span>
            </div>
            <div className="staff-choices">
              {selectedTrack.staves.map((staff) => (
                <button
                  key={staff.id}
                  disabled={busy}
                  aria-pressed={staff.id === cursor.staffId}
                  onClick={() => selectStaff(selectedTrack.id, staff.id)}
                >
                  {staff.clef === 'treble' ? 'Treble staff' : 'Bass staff'}
                </button>
              ))}
            </div>
            <p className="help">
              Click a staff to write at the previewed pitch and beat. Click an existing note to
              select it.
            </p>
            <dl className="keyboard-guide">
              <dt>1–5</dt>
              <dd>Whole → sixteenth</dd>
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
              Use the measure header or right-click a staff for entry options. MIDI, playback, and
              the remaining Milestone 2 features are still future work.
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
                    tick: score.measureCount * ticksPerMeasure(score),
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
          <div className="entry-bar">
            <NotationToolbar settings={settings} disabled={busy} onChange={entrySettings} />
            <div className="entry-commands">
              <button disabled={busy} onClick={() => enter()}>
                {settings.rest ? 'Insert rest' : 'Enter note'}
              </button>
              <button disabled={busy || !cursor.eventId} onClick={removeSelected}>
                Delete selected
              </button>
              <button
                disabled={busy || selectedEvents.length === 0}
                onClick={() => {
                  const last = selectedEvents.at(-1)!
                  change(removeLastEvent(score, cursor.trackId, selectedMeasure, cursor.staffId))
                  setCursor({ ...cursor, tick: last.startTick, eventId: undefined })
                }}
              >
                Remove last entry
              </button>
            </div>
            <p className="cursor-status" aria-live="polite">
              {selectedTrack.name} · {selectedStaff.clef} · Measure {selectedMeasure + 1}, beat{' '}
              {(cursor.tick % ticksPerMeasure(score)) / 480 + 1}
              {cursor.tick === score.measureCount * ticksPerMeasure(score) ? ' · End of score' : ''}
              {cursor.eventId
                ? ' · Entry selected'
                : ` · ${cursor.pitch.step}${cursor.pitch.accidental}${cursor.pitch.octave}`}
            </p>
          </div>
          <ScoreView
            score={score}
            cursor={cursor}
            settings={settings}
            disabled={busy}
            onSelect={(next) => {
              if (!busy) {
                setCursor(next)
                setError('')
              }
            }}
            onInsert={enter}
            onSettings={entrySettings}
          />
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
