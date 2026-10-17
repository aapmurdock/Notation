import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { PPQ, getStaff, pitchToMidi, type Composition } from '../../shared/composition'
import {
  HIGHEST_MIDI,
  LOWEST_MIDI,
  linkedNotes,
  midiName,
  pianoNotes,
  pitchName,
  SNAP_CHOICES,
  snapTick,
  resizedDuration,
  type NewNoteStaff,
  type NoteUpdate,
  type RollNote,
  type SnapTicks,
} from '../../shared/piano-roll'
import {
  measureAtTick,
  measureStart,
  scoreEnd,
  signatureAt,
  resolvedPitch,
} from '../../shared/signatures'
import { durationChoices, type EntrySettings } from '../NotationToolbar'
import type { ScoreCursor } from '../score/ScoreView'
import {
  KEYBOARD_WIDTH,
  RULER_HEIGHT,
  midiAtY,
  tickAtX,
  timelineMarks,
  xAtTick,
  yAtMidi,
} from './geometry'

export interface RollPreferences {
  snap: SnapTicks
  quarterWidth: number
  rowHeight: number
  tool: 'draw' | 'select'
  newStaff: NewNoteStaff
}
export interface RollScroll {
  left: number
  top: number
}
interface Position {
  x: number
  y: number
}
interface Gesture {
  pointerId: number
  kind: 'move' | 'resize' | 'marquee'
  origin: Position
  client: Position
  point: Position
  notes: RollNote[]
  clickedId?: string
  priorSelection: string[]
  moved: boolean
  deltaTick: number
  deltaMidi: number
  deltaDuration: number
}

export function PianoRoll({
  score,
  trackId,
  cursor,
  selection,
  settings,
  preferences,
  disabled,
  initialScroll,
  onScroll,
  onPreferences,
  onSelect,
  onInsert,
  onEdit,
  onDelete,
  onSettings,
  onAudition,
  onStopAudition,
}: {
  score: Composition
  trackId: string
  cursor: ScoreCursor
  selection: string[]
  settings: EntrySettings
  preferences: RollPreferences
  disabled: boolean
  initialScroll?: RollScroll
  onScroll(position: RollScroll): void
  onPreferences(next: RollPreferences): void
  onSelect(ids: string[], at?: { tick: number; midi: number }): void
  onInsert(tick: number, midi: number, duration: number, staff: NewNoteStaff): void
  onEdit(updates: NoteUpdate[]): void
  onDelete(): void
  onSettings(settings: EntrySettings, field?: keyof EntrySettings): void
  onAudition(midi: number): void
  onStopAudition(): void
}) {
  const track = score.tracks.find((track) => track.id === trackId)!
  const notes = useMemo(() => pianoNotes(score, trackId), [score, trackId])
  const { snap, quarterWidth, rowHeight } = preferences
  const end = scoreEnd(score)
  const width = xAtTick(end, quarterWidth)
  const height = (HIGHEST_MIDI - LOWEST_MIDI + 1) * rowHeight
  const duration = settings.duration * (settings.dotted ? 1.5 : 1)
  const splitRows = useMemo(
    () =>
      new Set(
        notes
          .filter((note) =>
            notes.some(
              (other) =>
                other.staffId !== note.staffId &&
                other.midi === note.midi &&
                other.event.startTick < note.event.startTick + note.event.durationTicks &&
                note.event.startTick < other.event.startTick + other.event.durationTicks,
            ),
          )
          .map((note) => note.event.id),
      ),
    [notes],
  )
  function noteShape(note: RollNote, midi = note.midi) {
    const split = splitRows.has(note.event.id)
    return {
      y: yAtMidi(midi, rowHeight) + (split && note.clef === 'bass' ? rowHeight / 2 : 0) + 1,
      height: Math.max(4, (split ? rowHeight / 2 : rowHeight) - 2),
    }
  }
  const selected = new Set(selection)
  const viewport = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const dragging = useRef<Gesture | null>(null)
  const [error, setError] = useState('')
  const [hover, setHover] = useState<{ tick: number; midi: number } | null>(null)
  const scale = useRef<{ trackId: string; quarterWidth: number; rowHeight: number } | null>(null)
  const marks = useMemo(() => timelineMarks(score, snap), [score, snap])
  const pitches = Array.from(
    { length: HIGHEST_MIDI - LOWEST_MIDI + 1 },
    (_, index) => HIGHEST_MIDI - index,
  )
  function focus(): void {
    svg.current?.focus({ preventScroll: true })
  }
  function changeGesture(next: Gesture | null): void {
    dragging.current = next
    setGesture(next)
  }
  function cancel(): void {
    const current = dragging.current
    changeGesture(null)
    if (current && svg.current?.hasPointerCapture(current.pointerId))
      svg.current.releasePointerCapture(current.pointerId)
    setHover(null)
    onStopAudition()
  }
  useEffect(() => {
    setError('')
    if (dragging.current) cancel()
  }, [score, trackId, disabled, snap, quarterWidth, rowHeight, preferences.tool])
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dragging.current) {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }
    }
    const blur = (): void => {
      if (dragging.current) cancel()
    }
    window.addEventListener('keydown', escape, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', escape, true)
      window.removeEventListener('blur', blur)
    }
  })
  useEffect(() => () => onStopAudition(), [])
  useLayoutEffect(() => {
    const element = viewport.current!
    const old = scale.current
    if (!old || old.trackId !== trackId) {
      const note = notes.find((note) => selected.has(note.event.id))
      const centerTick = note?.event.startTick ?? cursor.tick
      const centerMidi = note?.midi ?? 60
      element.scrollLeft = !initialScroll
        ? Math.max(0, KEYBOARD_WIDTH + xAtTick(centerTick, quarterWidth) - element.clientWidth / 2)
        : initialScroll.left
      element.scrollTop = !initialScroll
        ? Math.max(0, yAtMidi(centerMidi, rowHeight) - element.clientHeight / 2)
        : initialScroll.top
    } else {
      const tick =
        ((element.scrollLeft + element.clientWidth / 2 - KEYBOARD_WIDTH) * PPQ) / old.quarterWidth
      const pitchRow = (element.scrollTop + element.clientHeight / 2 - RULER_HEIGHT) / old.rowHeight
      element.scrollLeft = KEYBOARD_WIDTH + xAtTick(tick, quarterWidth) - element.clientWidth / 2
      element.scrollTop = RULER_HEIGHT + pitchRow * rowHeight - element.clientHeight / 2
    }
    scale.current = { trackId, quarterWidth, rowHeight }
  }, [trackId, quarterWidth, rowHeight])

  function position(event: ReactPointerEvent<SVGElement>): Position {
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(
      svg.current!.getScreenCTM()!.inverse(),
    )
  }
  function perform(action: () => void): void {
    if (disabled) return
    try {
      action()
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to edit notes.')
    }
  }
  function begin(
    event: ReactPointerEvent<SVGElement>,
    note: RollNote,
    kind: 'move' | 'resize',
  ): void {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const point = position(event)
    focus()
    setError('')
    setHover(null)
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      onSelect(
        selected.has(note.event.id)
          ? selection.filter((id) => id !== note.event.id)
          : [...selection, note.event.id],
      )
      return
    }
    const ids = selected.has(note.event.id) ? selection : [note.event.id]
    if (!selected.has(note.event.id)) onSelect(ids)
    changeGesture({
      pointerId: event.pointerId,
      kind,
      origin: point,
      point,
      client: { x: event.clientX, y: event.clientY },
      notes: notes.filter((note) => ids.includes(note.event.id)),
      clickedId: note.event.id,
      priorSelection: ids,
      moved: false,
      deltaTick: 0,
      deltaMidi: 0,
      deltaDuration: 0,
    })
    svg.current!.setPointerCapture(event.pointerId)
  }
  function proposed(current: Gesture): NoteUpdate[] {
    return current.notes.map((note) =>
      current.kind === 'resize'
        ? { id: note.event.id, durationTicks: note.event.durationTicks + current.deltaDuration }
        : {
            id: note.event.id,
            startTick: note.event.startTick + current.deltaTick,
            midi: note.midi + current.deltaMidi,
          },
    )
  }
  function move(event: ReactPointerEvent<SVGSVGElement>): void {
    const point = position(event)
    const current = dragging.current
    if (!current) {
      setHover({ tick: tickAtX(point.x, quarterWidth, snap), midi: midiAtY(point.y, rowHeight) })
      return
    }
    if (event.pointerId !== current.pointerId) return
    const moved =
      current.moved ||
      Math.hypot(event.clientX - current.client.x, event.clientY - current.client.y) >= 4
    if (!moved) return
    const anchor = current.notes.find((note) => note.event.id === current.clickedId)
    let deltaTick = 0,
      deltaMidi = 0,
      deltaDuration = 0
    if (anchor) {
      if (current.kind === 'move') {
        deltaTick =
          Math.abs(event.clientX - current.client.x) < 3
            ? 0
            : snapTick(
                anchor.event.startTick + ((point.x - current.origin.x) * PPQ) / quarterWidth,
                snap,
              ) - anchor.event.startTick
        deltaMidi = Math.round((current.origin.y - point.y) / rowHeight)
        if (deltaMidi !== current.deltaMidi) onAudition(anchor.midi + deltaMidi)
      } else {
        const target = resizedDuration(
          anchor.event.durationTicks,
          Math.abs(event.clientX - current.client.x) < 3
            ? 0
            : ((point.x - current.origin.x) * PPQ) / quarterWidth,
          snap,
        )
        deltaDuration = target - anchor.event.durationTicks
      }
    }
    changeGesture({ ...current, point, moved, deltaTick, deltaMidi, deltaDuration })
  }
  function finish(event: ReactPointerEvent<SVGSVGElement>): void {
    const current = dragging.current
    if (!current || event.pointerId !== current.pointerId) return
    changeGesture(null)
    if (svg.current?.hasPointerCapture(event.pointerId))
      svg.current.releasePointerCapture(event.pointerId)
    if (current.kind === 'marquee') {
      const left = Math.min(current.origin.x, current.point.x),
        right = Math.max(current.origin.x, current.point.x)
      const top = Math.min(current.origin.y, current.point.y),
        bottom = Math.max(current.origin.y, current.point.y)
      const ids = current.moved
        ? notes
            .filter(
              (note) =>
                xAtTick(note.event.startTick, quarterWidth) <= right &&
                xAtTick(note.event.startTick + note.event.durationTicks, quarterWidth) >= left &&
                yAtMidi(note.midi, rowHeight) <= bottom &&
                yAtMidi(note.midi + 1, rowHeight) + rowHeight * 2 >= top,
            )
            .map((note) => note.event.id)
        : []
      onSelect([...new Set([...current.priorSelection, ...ids])], {
        tick: tickAtX(current.origin.x, quarterWidth, snap),
        midi: midiAtY(current.origin.y, rowHeight),
      })
    } else if (current.moved) perform(() => onEdit(proposed(current)))
    else if (current.clickedId) onSelect([current.clickedId])
  }
  function keyboard(event: React.KeyboardEvent): void {
    if (disabled || (event.target as HTMLElement).closest('input, select, textarea')) return
    const key = event.key.toLowerCase()
    if (event.ctrlKey || event.metaKey) {
      if (key === 'a') {
        event.preventDefault()
        event.stopPropagation()
        onSelect(notes.map((note) => note.event.id))
      }
      return
    }
    if (event.altKey) return
    const choice = durationChoices.find((choice) => choice.key === key)
    if (choice) {
      event.preventDefault()
      event.stopPropagation()
      onSettings(
        {
          ...settings,
          duration: choice.ticks,
          dotted: choice.ticks === 60 ? false : settings.dotted,
        },
        'duration',
      )
      return
    }
    if (key === '.' && settings.duration !== 60) {
      event.preventDefault()
      event.stopPropagation()
      onSettings({ ...settings, dotted: !settings.dotted }, 'dotted')
      return
    }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault()
      event.stopPropagation()
      perform(onDelete)
      return
    }
    if (key === 'escape') {
      event.preventDefault()
      onSelect([])
      cancel()
      return
    }
    if (key === 'enter' && event.target === svg.current) {
      event.preventDefault()
      event.stopPropagation()
      if (selection.length) onAudition(midiAtCursor)
      else
        perform(() => {
          onInsert(cursor.tick, midiAtCursor, duration, preferences.newStaff)
          onAudition(midiAtCursor)
        })
      return
    }
    if (key === 'v' || key === 'd') {
      event.preventDefault()
      onPreferences({ ...preferences, tool: key === 'v' ? 'select' : 'draw' })
      return
    }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      event.preventDefault()
      event.stopPropagation()
      const deltaTick = key === 'arrowleft' ? -snap : key === 'arrowright' ? snap : 0
      const deltaMidi =
        key === 'arrowup'
          ? event.shiftKey
            ? 12
            : 1
          : key === 'arrowdown'
            ? event.shiftKey
              ? -12
              : -1
            : 0
      const chosen = notes.filter((note) => selected.has(note.event.id))
      if (chosen.length)
        perform(() =>
          onEdit(
            chosen.map((note) => ({
              id: note.event.id,
              startTick: note.event.startTick + deltaTick,
              midi: note.midi + deltaMidi,
            })),
          ),
        )
      else
        onSelect([], {
          tick: Math.min(end - snap, Math.max(0, cursor.tick + deltaTick)),
          midi: Math.max(LOWEST_MIDI, Math.min(HIGHEST_MIDI, midiAtCursor + deltaMidi)),
        })
    }
  }
  const midiAtCursor =
    notes.find((note) => note.event.id === cursor.eventId)?.midi ??
    pitchToMidi(
      resolvedPitch(score, getStaff(score, trackId, cursor.staffId), cursor.tick, cursor.pitch),
    )
  const pending = gesture?.moved && gesture.kind !== 'marquee' ? proposed(gesture) : []
  const invalid = pending.some((update) => {
    const note = notes.find((note) => note.event.id === update.id)!
    return (
      (update.startTick ?? note.event.startTick) < 0 ||
      (update.startTick ?? note.event.startTick) +
        (update.durationTicks ?? note.event.durationTicks) >
        end ||
      (update.durationTicks ?? note.event.durationTicks) < 60 ||
      (update.midi ?? note.midi) < LOWEST_MIDI ||
      (update.midi ?? note.midi) > HIGHEST_MIDI
    )
  })
  return (
    <section
      className="piano-roll"
      aria-label="Piano roll editor"
      data-render-state="ready"
      onKeyDown={keyboard}
    >
      <header className="roll-heading">
        <div>
          <p className="eyebrow">PIANO ROLL</p>
          <h2>{track.name}</h2>
          <p>
            {track.staves.length === 2
              ? 'Treble and bass staves'
              : `${track.staves[0]!.clef} staff`}{' '}
            · {notes.length} notes
          </p>
        </div>
        {track.staves.length === 2 && (
          <div className="roll-staff-legend">
            <span className="treble-swatch">Treble</span>
            <span className="bass-swatch">Bass</span>
          </div>
        )}
      </header>
      <div className="roll-toolbar" role="toolbar" aria-label="Piano roll tools">
        <div className="tool-group">
          <button
            disabled={disabled}
            aria-pressed={preferences.tool === 'draw'}
            title="Draw notes (D)"
            onClick={() => onPreferences({ ...preferences, tool: 'draw' })}
          >
            Draw
          </button>
          <button
            disabled={disabled}
            aria-pressed={preferences.tool === 'select'}
            title="Select / drag a rectangle (V)"
            onClick={() => onPreferences({ ...preferences, tool: 'select' })}
          >
            Select
          </button>
        </div>
        <label>
          Snap
          <select
            aria-label="Piano roll snap"
            value={snap}
            disabled={disabled}
            onChange={(event) =>
              onPreferences({ ...preferences, snap: Number(event.target.value) as SnapTicks })
            }
          >
            {SNAP_CHOICES.map((choice) => (
              <option key={choice.ticks} value={choice.ticks}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <div className="tool-group">
          <button
            aria-label="Zoom timeline out"
            title="Zoom timeline out"
            disabled={quarterWidth <= 48}
            onClick={() => onPreferences({ ...preferences, quarterWidth: quarterWidth / 2 })}
          >
            −
          </button>
          <span className="zoom-label">{Math.round((quarterWidth / 96) * 100)}%</span>
          <button
            aria-label="Zoom timeline in"
            title="Zoom timeline in"
            disabled={quarterWidth >= 384}
            onClick={() => onPreferences({ ...preferences, quarterWidth: quarterWidth * 2 })}
          >
            +
          </button>
        </div>
        <label>
          Pitch rows
          <select
            aria-label="Pitch row height"
            value={rowHeight}
            onChange={(event) =>
              onPreferences({ ...preferences, rowHeight: Number(event.target.value) })
            }
          >
            <option value={12}>Small</option>
            <option value={18}>Medium</option>
            <option value={26}>Large</option>
          </select>
        </label>
        {track.staves.length === 2 && (
          <label>
            New notes
            <select
              aria-label="New-note staff"
              value={preferences.newStaff}
              disabled={disabled}
              onChange={(event) =>
                onPreferences({ ...preferences, newStaff: event.target.value as NewNoteStaff })
              }
            >
              <option value="auto">Auto · C4 and up treble</option>
              <option value="treble">Treble</option>
              <option value="bass">Bass</option>
            </select>
          </label>
        )}
        <button
          disabled={disabled || !selection.length}
          title="Select the existing chord and tied notes before a group edit"
          onClick={() => onSelect(linkedNotes(score, trackId, selection))}
        >
          Select chord / ties
        </button>
        {track.staves.length === 2 && (
          <div className="tool-group">
            {track.staves.map((staff) => (
              <button
                key={staff.id}
                disabled={disabled || !selection.length}
                aria-label={`Assign selected notes to ${staff.clef}`}
                onClick={() =>
                  perform(() =>
                    onEdit(
                      notes
                        .filter((note) => selected.has(note.event.id))
                        .map((note) => ({ id: note.event.id, staffId: staff.id })),
                    ),
                  )
                }
              >
                To {staff.clef}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="roll-help">
        {preferences.tool === 'draw'
          ? 'Click empty grid space to draw.'
          : 'Click empty space to deselect; drag a rectangle to select.'}{' '}
        Drag a block to move; drag its right edge to resize. Ctrl-click adds to selection. Escape
        cancels.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div
        ref={viewport}
        className="roll-viewport"
        aria-label={`${track.name} piano roll grid`}
        onScroll={() =>
          onScroll({ left: viewport.current!.scrollLeft, top: viewport.current!.scrollTop })
        }
      >
        <div
          className="roll-content"
          style={{ width: width + KEYBOARD_WIDTH, height: height + RULER_HEIGHT }}
        >
          <div className="roll-ruler">
            <svg
              width={width + KEYBOARD_WIDTH}
              height={RULER_HEIGHT}
              aria-label="Measure and beat ruler"
            >
              <rect width={width + KEYBOARD_WIDTH} height={RULER_HEIGHT} fill="#f1f4f9" />
              {marks.map((mark) => (
                <g key={mark.tick} data-tick={mark.tick} data-kind={mark.kind}>
                  <line
                    x1={KEYBOARD_WIDTH + xAtTick(mark.tick, quarterWidth)}
                    x2={KEYBOARD_WIDTH + xAtTick(mark.tick, quarterWidth)}
                    y1={mark.kind === 'measure' ? 0 : 19}
                    y2={28}
                    className={`roll-grid-line ${mark.kind}`}
                  />
                  {mark.label && (mark.kind === 'measure' || quarterWidth >= 96) && (
                    <text
                      x={KEYBOARD_WIDTH + xAtTick(mark.tick, quarterWidth) + 5}
                      y={16}
                      className={mark.kind === 'measure' ? 'measure-label' : 'beat-label'}
                    >
                      {mark.label}
                    </text>
                  )}
                </g>
              ))}
            </svg>
            <span className="roll-ruler-corner">PITCH</span>
          </div>
          <svg
            ref={svg}
            className="roll-grid"
            style={{ left: KEYBOARD_WIDTH, top: RULER_HEIGHT }}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            data-quarter-width={quarterWidth}
            data-row-height={rowHeight}
            data-snap={snap}
            role="group"
            tabIndex={disabled ? -1 : 0}
            aria-label="Editable piano roll notes"
            onPointerDown={(event) => {
              if (disabled || event.button !== 0) return
              event.preventDefault()
              const point = position(event)
              focus()
              setError('')
              const tick = tickAtX(point.x, quarterWidth, snap),
                midi = midiAtY(point.y, rowHeight)
              if (
                preferences.tool === 'draw' &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey
              ) {
                perform(() => {
                  onInsert(tick, midi, duration, preferences.newStaff)
                  onAudition(midi)
                })
              } else {
                const priorSelection =
                  event.ctrlKey || event.metaKey || event.shiftKey ? selection : []
                onSelect(priorSelection, { tick, midi })
                changeGesture({
                  pointerId: event.pointerId,
                  kind: 'marquee',
                  origin: point,
                  point,
                  client: { x: event.clientX, y: event.clientY },
                  notes: [],
                  priorSelection,
                  moved: false,
                  deltaTick: 0,
                  deltaMidi: 0,
                  deltaDuration: 0,
                })
                svg.current!.setPointerCapture(event.pointerId)
              }
            }}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={cancel}
            onLostPointerCapture={() => {
              if (dragging.current) cancel()
            }}
            onPointerLeave={() => {
              if (!dragging.current) setHover(null)
            }}
          >
            {pitches.map((midi) => (
              <rect
                key={midi}
                x={0}
                y={yAtMidi(midi, rowHeight)}
                width={width}
                height={rowHeight}
                data-midi={midi}
                className={`roll-pitch-row ${[1, 3, 6, 8, 10].includes(midi % 12) ? 'black' : ''} ${midi === 60 ? 'middle-c' : ''}`}
              />
            ))}
            <g pointerEvents="none">
              {marks.map((mark) => (
                <line
                  key={mark.tick}
                  x1={xAtTick(mark.tick, quarterWidth)}
                  x2={xAtTick(mark.tick, quarterWidth)}
                  y1={0}
                  y2={height}
                  data-grid-tick={mark.tick}
                  className={`roll-grid-line ${mark.kind}`}
                />
              ))}
            </g>
            <g className="roll-ties" pointerEvents="none">
              {notes
                .filter((note) => note.event.tieTo)
                .map((note) => {
                  const to = notes.find((target) => target.event.id === note.event.tieTo)!
                  const x = xAtTick(note.event.startTick + note.event.durationTicks, quarterWidth),
                    endX = xAtTick(to.event.startTick, quarterWidth)
                  const y = yAtMidi(note.midi, rowHeight) + rowHeight / 2
                  return (
                    <path
                      key={note.event.id}
                      d={`M${x - 6},${y} Q${(x + endX) / 2},${y - 10} ${endX + 6},${y}`}
                    />
                  )
                })}
            </g>
            {notes.map((note) => {
              const event = note.event,
                x = xAtTick(event.startTick, quarterWidth),
                y = noteShape(note).y
              const noteWidth = Math.max(3, xAtTick(event.durationTicks, quarterWidth)),
                handle = Math.min(6, Math.max(1, noteWidth * 0.3))
              const name = `${pitchName(event.pitch)} note, ${track.name} ${note.clef}, tick ${event.startTick}`
              return (
                <g
                  key={event.id}
                  className={`roll-note ${selected.has(event.id) ? 'selected' : ''} ${note.clef}`}
                  data-event-id={event.id}
                  data-midi={note.midi}
                  data-start-tick={event.startTick}
                  data-duration={event.durationTicks}
                  data-staff-id={note.staffId}
                  data-velocity={event.velocity}
                >
                  <rect
                    className="roll-note-body"
                    x={x}
                    y={y}
                    width={noteWidth}
                    height={noteShape(note).height}
                    rx={2}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-label={name}
                    aria-pressed={selected.has(event.id)}
                    onPointerDown={(event) => begin(event, note, 'move')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        event.stopPropagation()
                        onSelect([note.event.id])
                        onAudition(note.midi)
                      }
                    }}
                  />
                  {noteWidth > 42 && !splitRows.has(event.id) && (
                    <text
                      pointerEvents="none"
                      x={x + 5}
                      y={y + rowHeight * 0.7}
                      className="roll-note-label"
                    >
                      {midiName(note.midi)}
                    </text>
                  )}
                  <rect
                    className="roll-resize-handle"
                    x={x + noteWidth - handle}
                    y={y}
                    width={handle}
                    height={noteShape(note).height}
                    rx={1}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-label={`Resize ${name}`}
                    onPointerDown={(event) => begin(event, note, 'resize')}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                        event.preventDefault()
                        event.stopPropagation()
                        const chosen = selected.has(note.event.id)
                          ? notes.filter((note) => selected.has(note.event.id))
                          : [note]
                        const delta = event.key === 'ArrowRight' ? snap : -snap
                        perform(() =>
                          onEdit(
                            chosen.map((note) => ({
                              id: note.event.id,
                              durationTicks: resizedDuration(note.event.durationTicks, delta, snap),
                            })),
                          ),
                        )
                      }
                    }}
                  />
                </g>
              )
            })}
            {!gesture && hover && preferences.tool === 'draw' && (
              <rect
                className="roll-insert-preview"
                pointerEvents="none"
                data-tick={hover.tick}
                data-midi={hover.midi}
                x={xAtTick(hover.tick, quarterWidth)}
                y={yAtMidi(hover.midi, rowHeight) + 1}
                width={xAtTick(duration, quarterWidth)}
                height={rowHeight - 2}
                rx={2}
              />
            )}
            {pending.map((update) => {
              const note = notes.find((note) => note.event.id === update.id)!
              return (
                <rect
                  key={update.id}
                  className={`roll-drag-preview ${invalid ? 'invalid' : ''}`}
                  pointerEvents="none"
                  data-event-id={update.id}
                  data-start-tick={update.startTick ?? note.event.startTick}
                  data-midi={update.midi ?? note.midi}
                  data-duration={update.durationTicks ?? note.event.durationTicks}
                  x={xAtTick(update.startTick ?? note.event.startTick, quarterWidth)}
                  y={noteShape(note, update.midi ?? note.midi).y}
                  width={xAtTick(update.durationTicks ?? note.event.durationTicks, quarterWidth)}
                  height={noteShape(note).height}
                  rx={2}
                />
              )
            })}
            {gesture?.kind === 'marquee' && gesture.moved && (
              <rect
                className="roll-marquee"
                pointerEvents="none"
                x={Math.min(gesture.origin.x, gesture.point.x)}
                y={Math.min(gesture.origin.y, gesture.point.y)}
                width={Math.abs(gesture.point.x - gesture.origin.x)}
                height={Math.abs(gesture.point.y - gesture.origin.y)}
              />
            )}
            <line
              className="roll-edit-cursor"
              aria-label="Editing cursor"
              pointerEvents="none"
              x1={xAtTick(cursor.tick, quarterWidth)}
              x2={xAtTick(cursor.tick, quarterWidth)}
              y1={0}
              y2={height}
            />
          </svg>
          <div className="roll-keyboard">
            <svg width={KEYBOARD_WIDTH} height={height} aria-label="Piano keyboard">
              {pitches.map((midi) => (
                <g
                  key={midi}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={`Audition ${midiName(midi)}, MIDI ${midi}`}
                  className="roll-key"
                  data-midi={midi}
                  onPointerDown={(event) => {
                    if (!disabled && event.button === 0) {
                      event.preventDefault()
                      focus()
                      onAudition(midi)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault()
                      event.stopPropagation()
                      onAudition(midi)
                    }
                  }}
                >
                  <rect
                    x={0}
                    y={yAtMidi(midi, rowHeight)}
                    width={[1, 3, 6, 8, 10].includes(midi % 12) ? 43 : KEYBOARD_WIDTH}
                    height={rowHeight}
                    className={[1, 3, 6, 8, 10].includes(midi % 12) ? 'black-key' : 'white-key'}
                  />
                  {(midi % 12 === 0 || rowHeight >= 26) && (
                    <text
                      x={midi % 12 === 0 ? 45 : 7}
                      y={yAtMidi(midi, rowHeight) + rowHeight * 0.72}
                    >
                      {midiName(midi)}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>
      <p className="roll-selection-status" aria-live="polite">
        {selection.length} selected · Snap{' '}
        {SNAP_CHOICES.find((choice) => choice.ticks === snap)!.label} ·{' '}
        {hover
          ? `${midiName(hover.midi)}, measure ${Math.min(score.measureCount, measureAtTick(score, hover.tick) + 1)}, beat ${(hover.tick - measureStart(score, measureAtTick(score, hover.tick))) / ((PPQ * 4) / signatureAt(score, measureAtTick(score, hover.tick)).timeSignature.denominator) + 1}`
          : 'Ctrl+A selects all notes in this instrument.'}
      </p>
    </section>
  )
}
