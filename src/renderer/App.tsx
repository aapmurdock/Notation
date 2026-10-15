import { useEffect, useRef, useState } from 'react'
import {
  appendEvent, createComposition, createExample, createTrack, parseComposition,
  removeLastEvent, ticksPerMeasure,
  type Composition, type DurationTicks, type Pitch, type Step,
} from '../shared/composition'
import { ScoreView } from './score/ScoreView'

const instruments = [
  { name: 'Piano', clef: 'treble', program: 0 },
  { name: 'Violin', clef: 'treble', program: 40 },
  { name: 'Cello', clef: 'bass', program: 42 },
  { name: 'Flute', clef: 'treble', program: 73 },
] as const

export function App() {
  const [score, setScore] = useState<Composition>(createExample)
  const [selectedTrackId, setSelectedTrackId] = useState(score.tracks[0]!.id)
  const [selectedMeasure, setSelectedMeasure] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [message, setMessage] = useState('Select a measure to start composing.')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<Step>('C')
  const [octave, setOctave] = useState(4)
  const [accidental, setAccidental] = useState<Pitch['accidental']>('')
  const [duration, setDuration] = useState<DurationTicks>(480)
  const [instrument, setInstrument] = useState(0)
  const titleInput = useRef<HTMLInputElement>(null)
  const selectedTrack = score.tracks.find((track) => track.id === selectedTrackId)!
  const selectedEvents = selectedTrack.events.filter((event) => Math.floor(event.startTick / ticksPerMeasure(score)) === selectedMeasure)
  const notes = score.tracks.flatMap((track) => track.events).filter((event) => event.kind === 'note').length

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
    } catch (cause) { showError(cause) }
  }
  function showError(cause: unknown): void {
    setError(cause instanceof Error ? cause.message : 'Something went wrong.')
  }
  function replace(next: Composition, name: string | null = null): void {
    setScore(next); setSelectedTrackId(next.tracks[0]!.id); setSelectedMeasure(0)
    setDirty(false); setFileName(name); setError('')
  }
  function canReplace(): boolean {
    return !dirty || window.confirm('Discard unsaved changes to this composition?')
  }
  async function openScore(): Promise<void> {
    if (!window.notation || !canReplace()) return
    setBusy(true); setError('')
    try {
      const result = await window.notation.openScore()
      if (result.status === 'ok') {
        replace(parseComposition(result.value.score), result.value.fileName)
        setMessage(`Opened ${result.value.fileName}.`)
      } else if (result.status === 'error') setError(result.message)
    } catch (cause) { showError(cause) }
    finally { setBusy(false) }
  }
  async function saveScore(): Promise<void> {
    if (!window.notation) return
    setBusy(true); setError('')
    try {
      const result = await window.notation.saveScore(score)
      if (result.status === 'ok') {
        setDirty(false); setFileName(result.value.fileName); setMessage(`Saved ${result.value.fileName}.`)
      } else if (result.status === 'error') setError(result.message)
    } catch (cause) { showError(cause) }
    finally { setBusy(false) }
  }
  function enter(kind: 'note' | 'rest'): void {
    try {
      const input = kind === 'note'
        ? { kind, durationTicks: duration, pitch: { step, octave, accidental } }
        : { kind, durationTicks: duration }
      change(appendEvent(score, selectedTrackId, selectedMeasure, input))
      setMessage(`Added ${kind} to ${selectedTrack.name}, measure ${selectedMeasure + 1}.`)
    } catch (cause) { showError(cause) }
  }

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true">♮</span><div>Notation<small>A SPACE TO COMPOSE</small></div></div>
      <span className="milestone">Milestone 01 <span>Score workspace</span></span>
      <nav aria-label="File actions">
        <button disabled={busy} onClick={() => {
          if (canReplace()) { replace(createComposition()); setMessage('New composition created.') }
        }}>New score</button>
        <button disabled={busy || !window.notation} onClick={() => void openScore()}>Open</button>
        <button className="primary" disabled={busy || !window.notation} onClick={() => void saveScore()}>{busy ? 'Working…' : 'Save score'}</button>
      </nav>
    </header>
    <div className="workspace">
      <aside className="sidebar" aria-label="Composition tools">
        <section className="tool-section">
          <p className="eyebrow">YOUR COMPOSITION</p>
          <label htmlFor="title">Title</label>
          <input ref={titleInput} id="title" key={score.id} defaultValue={score.title} maxLength={120} disabled={busy}
            onBlur={(event) => {
              if (event.target.value.trim() && event.target.value !== score.title) change({ ...score, title: event.target.value.trim() })
              event.target.value = event.target.value.trim() || score.title
            }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
          <div className="field-row">
            <label>Tempo <span className="unit">BPM</span><input aria-label="Tempo" type="number" min={30} max={240} defaultValue={score.tempoBpm}
              key={`${score.id}-${score.tempoBpm}`} disabled={busy}
              onBlur={(event) => {
                if (Number(event.target.value) !== score.tempoBpm) change({ ...score, tempoBpm: Number(event.target.value) })
                event.target.value = String(Number.isInteger(Number(event.target.value)) && Number(event.target.value) >= 30 && Number(event.target.value) <= 240 ? Number(event.target.value) : score.tempoBpm)
              }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
            <div className="signature"><span>Time / Key</span><strong>{score.timeSignature.numerator}/4 <small>C major</small></strong></div>
          </div>
        </section>
        <section className="tool-section">
          <div className="section-heading"><h2>Parts</h2><span>{score.tracks.length} / 16</span></div>
          <div className="part-list" aria-label="Parts">{score.tracks.map((track, index) => <button key={track.id}
            className={`part-button ${track.id === selectedTrackId ? 'active' : ''}`} disabled={busy}
            aria-pressed={track.id === selectedTrackId} onClick={() => { setSelectedTrackId(track.id); setError('') }}>
            <span className="part-number">{String(index + 1).padStart(2, '0')}</span>
            <span>{track.name}<small>{track.clef} clef</small></span><span aria-hidden="true">›</span>
          </button>)}</div>
          <div className="add-part">
            <select aria-label="New part instrument" value={instrument} disabled={busy} onChange={(event) => setInstrument(Number(event.target.value))}>
              {instruments.map((item, index) => <option value={index} key={item.name}>{item.name}</option>)}
            </select>
            <button disabled={busy || score.tracks.length >= 16} onClick={() => {
              const item = instruments[instrument]!
              const count = score.tracks.filter((track) => track.name.startsWith(item.name)).length
              const track = createTrack(`${item.name}${count ? ` ${count + 1}` : ''}`, item.clef, item.program)
              change({ ...score, tracks: [...score.tracks, track] }); setSelectedTrackId(track.id)
            }}>+ Add part</button>
          </div>
        </section>
        <section className="tool-section note-tools">
          <div className="section-heading"><h2>Note entry</h2><span>BAR {selectedMeasure + 1}</span></div>
          <p className="help">Append to the selected measure. Unfilled beats appear as rests.</p>
          <div className="pitch-fields">
            <label>Pitch<select value={step} disabled={busy} onChange={(event) => setStep(event.target.value as Step)}>{['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Accidental<select value={accidental} disabled={busy} onChange={(event) => setAccidental(event.target.value as Pitch['accidental'])}><option value="">Natural</option><option value="#">Sharp ♯</option><option value="b">Flat ♭</option></select></label>
            <label>Octave<select value={octave} disabled={busy} onChange={(event) => setOctave(Number(event.target.value))}>{[2, 3, 4, 5, 6].map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
          <label>Duration<select value={duration} disabled={busy} onChange={(event) => setDuration(Number(event.target.value) as DurationTicks)}>
            <option value={1920}>Whole · 4 beats</option><option value={960}>Half · 2 beats</option><option value={480}>Quarter · 1 beat</option><option value={240}>Eighth · ½ beat</option><option value={120}>Sixteenth · ¼ beat</option>
          </select></label>
          <div className="entry-actions"><button className="primary" disabled={busy} onClick={() => enter('note')}>+ Add note</button><button disabled={busy} onClick={() => enter('rest')}>Add rest</button></div>
          <button className="text-button" disabled={busy || selectedEvents.length === 0} onClick={() => change(removeLastEvent(score, selectedTrackId, selectedMeasure))}>Remove last entry</button>
        </section>
        <div className="sidebar-note"><strong>One idea at a time.</strong><p>This first milestone focuses on writing a score. Playback, MIDI recording, and piano roll editing come later.</p></div>
      </aside>
      <main>
        <div className="workspace-toolbar"><div><span className="eyebrow">SCORE VIEW</span><p>{score.tracks.length} {score.tracks.length === 1 ? 'part' : 'parts'} <span>·</span> {score.measureCount} measures <span>·</span> {notes} notes</p></div>
          <div className="toolbar-actions"><button disabled={busy} onClick={() => {
            if (canReplace()) { replace(createExample()); setMessage('Example melody loaded.') }
          }}>Load example</button><button disabled={busy || score.measureCount >= 64} onClick={() => {
            change({ ...score, measureCount: score.measureCount + 1 }); setSelectedMeasure(score.measureCount)
          }}>+ Add measure</button></div>
        </div>
        {!window.notation && <p className="browser-notice">Browser preview · Launch the desktop app to open and save score files.</p>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        <ScoreView score={score} selectedTrackId={selectedTrackId} selectedMeasure={selectedMeasure}
          onSelect={(trackId, measure) => { if (!busy) { setSelectedTrackId(trackId); setSelectedMeasure(measure); setError('') } }} />
      </main>
    </div>
    <footer className="status-bar"><span className={`status-dot ${dirty ? 'unsaved' : ''}`} /><span role="status">{message}</span><span className="file-status">{dirty ? 'Unsaved changes' : fileName ?? 'Not saved to disk'}</span></footer>
  </div>
}
