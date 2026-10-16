import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { type Composition, type Pitch } from '../../shared/composition'
import { NotationToolbar, type EntrySettings } from '../NotationToolbar'
import { engrave, type Engraving, type StaffMeasure } from './engrave'
import { SignatureEditor } from '../SignatureEditor'
import {
  measureAtTick,
  measureStart,
  measureTicks,
  scoreEnd,
  signatureAt,
  timeName,
  keyName,
  type KeySignature,
  type TimeSignature,
} from '../../shared/signatures'
import { pitchAtY, tickAtX, xForTick, yForPitch } from './geometry'

export interface ScoreCursor {
  trackId: string
  staffId: string
  tick: number
  pitch: Pitch
  eventId?: string
  selectedIds?: string[]
}
interface Preview {
  measure: StaffMeasure
  tick: number
  pitch: Pitch
}

export function ScoreView({
  score,
  cursor,
  settings,
  disabled,
  onSelect,
  onInsert,
  onSettings,
  onPitchChange,
  onAudition,
  onStopAudition,
  onSignatureChange,
}: {
  score: Composition
  cursor: ScoreCursor
  settings: EntrySettings
  disabled: boolean
  onSelect(cursor: ScoreCursor): void
  onInsert(cursor: ScoreCursor, rest?: boolean): void
  onSettings(settings: EntrySettings, field?: keyof EntrySettings): void
  onPitchChange(eventId: string, staffId: string, pitch: Pitch): void
  onAudition(staffId: string, tick: number, pitch: Pitch, eventId?: string): void
  onStopAudition(): void
  onSignatureChange(
    measure: number,
    change: { keySignature?: KeySignature; timeSignature?: TimeSignature },
  ): void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const interaction = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(800)
  const [layout, setLayout] = useState<Engraving | null>(null)
  const [drawing, setDrawing] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [popover, setPopover] = useState<{ left: number; top: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{
    pointerId: number
    measure: StaffMeasure
    item: StaffMeasure['events'][number]
    pitch: Pitch
    offsetY: number
  } | null>(null)
  const dragging = useRef(drag)
  function updateDrag(next: typeof drag): void {
    dragging.current = next
    setDrag(next)
  }
  function cancelDrag(): void {
    const current = dragging.current
    updateDrag(null)
    if (current && interaction.current?.hasPointerCapture(current.pointerId))
      interaction.current.releasePointerCapture(current.pointerId)
    onStopAudition()
  }
  useEffect(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dragging.current) {
        event.preventDefault()
        event.stopPropagation()
        cancelDrag()
      }
    }
    const blur = (): void => {
      if (dragging.current) cancelDrag()
    }
    window.addEventListener('keydown', cancel, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', cancel, true)
      window.removeEventListener('blur', blur)
    }
  })
  const [signatureEditor, setSignatureEditor] = useState<{
    measure: number
    kind: 'key' | 'time'
    left: number
    top: number
  } | null>(null)
  function closeSignature(): void {
    setSignatureEditor(null)
    interaction.current?.focus({ preventScroll: true })
  }

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(300, Math.floor(entry.contentRect.width)))
    })
    observer.observe(viewport.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let cancelled = false
    setError('')
    setDrawing(true)
    setPreview(null)
    setPopover(null)
    setSignatureEditor(null)
    if (dragging.current) cancelDrag()
    async function draw(): Promise<void> {
      try {
        await Promise.all([
          document.fonts.load('16px Bravura'),
          document.fonts.load('16px Academico'),
        ])
        if (!cancelled && container.current) {
          setLayout(engrave(container.current, score, width))
          setDrawing(false)
        }
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : 'Unable to engrave this score.')
      }
    }
    void draw()
    return () => {
      cancelled = true
    }
  }, [score, width])
  useEffect(() => {
    if (!popover) return
    popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    const dismiss = (event: globalThis.PointerEvent): void => {
      if (!popoverRef.current?.contains(event.target as Node)) setPopover(null)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPopover(null)
        interaction.current?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [popover])

  function target(event: ReactPointerEvent<SVGElement>, measure: StaffMeasure): Preview {
    const matrix = interaction.current!.getScreenCTM()!
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return {
      measure,
      tick: tickAtX(
        measure.anchors,
        position.x,
        measureStart(score, measure.measure),
        measureTicks(score, measure.measure),
        settings.dotted ? settings.duration * 1.5 : settings.duration,
      ),
      pitch: pitchAtY(
        position.y,
        measure.bottom,
        measure.spacing,
        measure.clef,
        settings.accidental,
      ),
    }
  }
  function selectMeasure(measure: StaffMeasure, showPopover = false): void {
    if (disabled) return
    onSelect(
      cursor.staffId === measure.staffId &&
        measureAtTick(score, cursor.tick) === measure.measure &&
        !cursor.eventId
        ? cursor
        : {
            trackId: measure.trackId,
            staffId: measure.staffId,
            tick: measureStart(score, measure.measure),
            pitch: {
              step: 'C',
              octave: measure.clef === 'bass' ? 3 : 4,
              accidental: settings.accidental,
            },
          },
    )
    setPreview(null)
    if (showPopover && layout)
      setPopover({
        left: Math.min(measure.x, Math.max(0, layout.width - 370)),
        top: measure.top - 14,
      })
  }
  function selectEvent(
    measure: StaffMeasure,
    item: StaffMeasure['events'][number],
    additive = false,
  ): void {
    if (disabled) return
    interaction.current?.focus({ preventScroll: true })
    setPopover(null)
    setPreview(null)
    const previous = cursor.selectedIds ?? (cursor.eventId ? [cursor.eventId] : [])
    const ids = additive
      ? previous.includes(item.event.id)
        ? previous.filter((id) => id !== item.event.id)
        : [...previous, item.event.id]
      : [item.event.id]
    const activeId = ids.includes(item.event.id) ? item.event.id : ids.at(-1)
    const active = layout?.measures
      .flatMap((measure) => measure.events.map((item) => ({ measure, item })))
      .find(({ item }) => item.event.id === activeId)
    const entry = active?.item ?? item
    const staff = active?.measure ?? measure
    onSelect({
      trackId: staff.trackId,
      staffId: staff.staffId,
      tick: entry.event.startTick,
      pitch: entry.event.kind === 'note' ? entry.event.pitch : cursor.pitch,
      eventId: activeId,
      selectedIds: ids,
    })
  }
  const cursorMeasure = layout?.measures.find(
    (measure) =>
      measure.staffId === cursor.staffId &&
      measure.measure === Math.min(score.measureCount - 1, measureAtTick(score, cursor.tick)),
  )
  const hovered = drag
    ? { measure: drag.measure, tick: drag.item.event.startTick, pitch: drag.pitch }
    : settings.mode === 'write' && !disabled && !drawing
      ? preview
        ? { ...preview, pitch: { ...preview.pitch, accidental: settings.accidental } }
        : cursorMeasure && !cursor.eventId && cursor.tick < scoreEnd(score)
          ? {
              measure: cursorMeasure,
              tick: cursor.tick,
              pitch: { ...cursor.pitch, accidental: settings.accidental },
            }
          : null
      : null
  const px = hovered ? xForTick(hovered.measure.anchors, hovered.tick) : 0
  const py = hovered
    ? yForPitch(
        hovered.pitch,
        hovered.measure.bottom,
        hovered.measure.spacing,
        hovered.measure.clef,
      )
    : 0

  return (
    <article className="score-page" aria-label="Sheet music">
      <header className="score-heading">
        <p className="eyebrow">FULL SCORE · {keyName(score.keySignature)}</p>
        <h2>{score.title}</h2>
        <p>
          ♩ = {score.tempoBpm} <span>•</span> {timeName(score.timeSignature)}
        </p>
      </header>
      <div ref={viewport} className="score-viewport">
        <div className="score-canvas" style={layout ? { width: layout.width } : undefined}>
          <div
            ref={container}
            className="engraving"
            data-render-state={layout && !drawing ? 'ready' : 'loading'}
          />
          {layout && (
            <svg
              ref={interaction}
              className="score-interaction"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              tabIndex={0}
              role="group"
              aria-label="Interactive score"
              onPointerLeave={() => setPreview(null)}
              onPointerMove={(event) => {
                const current = dragging.current
                if (!current || current.pointerId !== event.pointerId) return
                const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
                  interaction.current!.getScreenCTM()!.inverse(),
                )
                const pitch = pitchAtY(
                  point.y - current.offsetY,
                  current.measure.bottom,
                  current.measure.spacing,
                  current.measure.clef,
                  current.pitch.accidental,
                )
                if (pitch.step !== current.pitch.step || pitch.octave !== current.pitch.octave) {
                  updateDrag({ ...current, pitch })
                  onAudition(
                    current.measure.staffId,
                    current.item.event.startTick,
                    pitch,
                    current.item.event.id,
                  )
                }
              }}
              onPointerUp={(event) => {
                const current = dragging.current
                if (!current || current.pointerId !== event.pointerId) return
                updateDrag(null)
                if (interaction.current?.hasPointerCapture(event.pointerId))
                  interaction.current.releasePointerCapture(event.pointerId)
                if (
                  current.item.event.kind === 'note' &&
                  (current.pitch.step !== current.item.event.pitch.step ||
                    current.pitch.octave !== current.item.event.pitch.octave)
                )
                  onPitchChange(current.item.event.id, current.measure.staffId, current.pitch)
              }}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={() => {
                if (dragging.current) cancelDrag()
              }}
            >
              {layout.measures.map((measure) => {
                const active =
                  cursor.staffId === measure.staffId && cursorMeasure?.measure === measure.measure
                return (
                  <g
                    key={`${measure.staffId}-${measure.measure}`}
                    data-staff-id={measure.staffId}
                    data-clef={measure.clef}
                    data-measure={measure.measure}
                    data-system={measure.system}
                    data-x={measure.x}
                    data-width={measure.width}
                    data-top={measure.top}
                    data-bottom={measure.bottom}
                    data-note-start={measure.anchors[0]!.x}
                    data-note-end={measure.anchors.at(-1)!.x}
                  >
                    <rect
                      className={`staff-hit ${active ? 'active' : ''}`}
                      x={measure.x}
                      y={measure.top - 25}
                      width={measure.width}
                      height={90}
                      fill="transparent"
                      onPointerMove={(event) => {
                        if (!disabled) setPreview(target(event, measure))
                      }}
                      onPointerDown={(event) => {
                        if (disabled || drawing || event.button !== 0) return
                        event.preventDefault()
                        // Capture the event's position before focus can change the viewport transform.
                        const hit = target(event, measure)
                        interaction.current?.focus({ preventScroll: true })
                        setPopover(null)
                        const next = {
                          trackId: measure.trackId,
                          staffId: measure.staffId,
                          tick: hit.tick,
                          pitch: hit.pitch,
                        }
                        if (settings.mode === 'select') onSelect(next)
                        else onInsert(next, settings.rest)
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        selectMeasure(measure, true)
                      }}
                    />
                    <rect
                      className="measure-target"
                      role="button"
                      tabIndex={disabled ? -1 : 0}
                      aria-label={`Select ${measure.name} ${measure.clef} measure ${measure.measure + 1}`}
                      aria-pressed={active}
                      x={measure.x}
                      y={measure.top - 33}
                      width={48}
                      height={22}
                      fill="transparent"
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        event.preventDefault()
                        selectMeasure(measure, true)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          event.stopPropagation()
                          selectMeasure(measure, true)
                        }
                      }}
                    />
                    {measure.events.map((item) => (
                      <rect
                        key={item.event.id}
                        className="event-hit"
                        role="button"
                        tabIndex={disabled ? -1 : 0}
                        aria-label={`${item.event.kind === 'note' ? `${item.event.pitch.step}${item.event.pitch.accidental === 'n' ? '♮' : item.event.pitch.accidental}${item.event.pitch.octave} note` : 'Rest'}, ${measure.name} ${measure.clef}, measure ${measure.measure + 1}, beat ${(item.event.startTick - measureStart(score, measure.measure)) / 480 + 1}`}
                        aria-pressed={
                          cursor.selectedIds
                            ? cursor.selectedIds.includes(item.event.id)
                            : item.event.id === cursor.eventId
                        }
                        data-event-id={item.event.id}
                        data-tick={item.event.startTick}
                        data-duration={item.event.durationTicks}
                        x={item.x - 3}
                        y={
                          item.y -
                          (measure.events.some(
                            (other) =>
                              other.event.startTick === item.event.startTick &&
                              other.event.id !== item.event.id &&
                              Math.abs(other.y - item.y) < 10,
                          )
                            ? 2.4
                            : 7)
                        }
                        width={17}
                        height={
                          measure.events.some(
                            (other) =>
                              other.event.startTick === item.event.startTick &&
                              other.event.id !== item.event.id &&
                              Math.abs(other.y - item.y) < 10,
                          )
                            ? 4.8
                            : 14
                        }
                        fill="transparent"
                        onPointerMove={() => setPreview(null)}
                        onPointerDown={(event) => {
                          if (event.button === 0) {
                            event.stopPropagation()
                            event.preventDefault()
                            const position = new DOMPoint(
                              event.clientX,
                              event.clientY,
                            ).matrixTransform(interaction.current!.getScreenCTM()!.inverse())
                            selectEvent(measure, item, event.shiftKey)
                            if (item.event.kind === 'note' && !event.shiftKey) {
                              updateDrag({
                                pointerId: event.pointerId,
                                measure,
                                item,
                                pitch: item.event.pitch,
                                offsetY:
                                  position.y -
                                  yForPitch(
                                    item.event.pitch,
                                    measure.bottom,
                                    measure.spacing,
                                    measure.clef,
                                  ),
                              })
                              interaction.current!.setPointerCapture(event.pointerId)
                            }
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.stopPropagation()
                            selectEvent(measure, item)
                          }
                        }}
                      />
                    ))}
                    {measure.signatures.map((signature) => {
                      const activeSignature = signatureAt(score, measure.measure)
                      const label = `${signature.kind === 'key' ? 'Key' : 'Time'} signature, ${measure.name} ${measure.clef}, measure ${measure.measure + 1}: ${signature.kind === 'key' ? keyName(activeSignature.keySignature) : timeName(activeSignature.timeSignature)}`
                      const open = (): void => {
                        if (disabled || drawing) return
                        setPopover(null)
                        setPreview(null)
                        setSignatureEditor({
                          measure: measure.measure,
                          kind: signature.kind,
                          left: Math.min(signature.x, Math.max(0, layout.width - 270)),
                          top: measure.top + 50,
                        })
                      }
                      return (
                        <g key={signature.kind}>
                          {signature.empty && (
                            <text
                              x={signature.x + 3}
                              y={signature.y + 11}
                              className="signature-hint"
                              pointerEvents="none"
                            >
                              {signature.kind === 'key' ? 'K' : 'T'}
                            </text>
                          )}
                          <rect
                            className="signature-target"
                            role="button"
                            tabIndex={disabled ? -1 : 0}
                            aria-label={label}
                            x={signature.x}
                            y={signature.y}
                            width={signature.width}
                            height={signature.height}
                            fill="transparent"
                            onPointerDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              open()
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                event.stopPropagation()
                                open()
                              }
                            }}
                          />
                        </g>
                      )
                    })}
                  </g>
                )
              })}
              {cursorMeasure && !cursor.eventId && (
                <line
                  className="insertion-caret"
                  pointerEvents="none"
                  x1={xForTick(cursorMeasure.anchors, cursor.tick) - 5}
                  x2={xForTick(cursorMeasure.anchors, cursor.tick) - 5}
                  y1={cursorMeasure.top - 10}
                  y2={cursorMeasure.bottom + 10}
                />
              )}
              {layout.measures
                .flatMap((measure) => measure.events)
                .filter((item) =>
                  (cursor.selectedIds ?? (cursor.eventId ? [cursor.eventId] : [])).includes(
                    item.event.id,
                  ),
                )
                .map((selected) => (
                  <ellipse
                    key={selected.event.id}
                    className="selected-entry"
                    pointerEvents="none"
                    cx={selected.x + 4}
                    cy={selected.y}
                    rx={13}
                    ry={11}
                  />
                ))}
              {hovered && (
                <g
                  className="note-preview"
                  pointerEvents="none"
                  aria-hidden="true"
                  data-preview-pitch={`${hovered.pitch.step}${hovered.pitch.accidental}${hovered.pitch.octave}`}
                  data-preview-tick={hovered.tick}
                >
                  <line
                    x1={px}
                    x2={px}
                    y1={hovered.measure.top - 10}
                    y2={hovered.measure.bottom + 10}
                    className="preview-guide"
                  />
                  {Array.from(
                    {
                      length: Math.ceil(
                        Math.max(hovered.measure.top - py, py - hovered.measure.bottom, 0) / 10,
                      ),
                    },
                    (_, i) => [
                      hovered.measure.top - (i + 1) * 10,
                      hovered.measure.bottom + (i + 1) * 10,
                    ],
                  )
                    .flat()
                    .filter(
                      (y) =>
                        y >= Math.min(py, hovered.measure.top) &&
                        y <= Math.max(py, hovered.measure.bottom),
                    )
                    .map((y) => (
                      <line key={y} x1={px - 7} x2={px + 17} y1={y} y2={y} stroke="currentColor" />
                    ))}
                  {settings.rest && !drag ? (
                    <text x={px - 6} y={py + 4} fontSize={14}>
                      rest
                    </text>
                  ) : (
                    <>
                      <ellipse
                        cx={px + 4}
                        cy={py}
                        rx={6}
                        ry={4}
                        transform={`rotate(-18 ${px + 4} ${py})`}
                        fill={settings.duration >= 960 ? 'white' : 'currentColor'}
                        stroke="currentColor"
                        strokeWidth={1.6}
                      />
                      {settings.dotted && (
                        <circle cx={px + 15} cy={py - 2} r={1.8} fill="currentColor" />
                      )}
                      {settings.duration < 1920 && (
                        <line
                          x1={px + 9}
                          x2={px + 9}
                          y1={py}
                          y2={py - 28}
                          stroke="currentColor"
                          strokeWidth={1.6}
                        />
                      )}
                    </>
                  )}
                  <text className="preview-label" x={px - 8} y={hovered.measure.bottom + 33}>
                    {settings.rest && !drag
                      ? 'Rest'
                      : `${hovered.pitch.step}${hovered.pitch.accidental}${hovered.pitch.octave}`}{' '}
                    · beat {(hovered.tick - measureStart(score, hovered.measure.measure)) / 480 + 1}
                  </text>
                </g>
              )}
            </svg>
          )}
          {signatureEditor && (
            <div
              className="measure-popover signature-popover"
              role="dialog"
              aria-label={`${signatureEditor.kind === 'key' ? 'Key' : 'Time'} signature editor`}
              style={{ left: signatureEditor.left, top: signatureEditor.top }}
            >
              <SignatureEditor
                disabled={disabled}
                score={score}
                measure={signatureEditor.measure}
                kind={signatureEditor.kind}
                onChange={onSignatureChange}
                onClose={closeSignature}
              />
            </div>
          )}
          {popover && (
            <div
              ref={popoverRef}
              className="measure-popover"
              role="dialog"
              aria-label="Measure entry options"
              style={{ left: popover.left, top: popover.top }}
            >
              <div className="popover-heading">
                Note entry{' '}
                <button
                  aria-label="Close entry options"
                  onClick={() => {
                    setPopover(null)
                    interaction.current?.focus({ preventScroll: true })
                  }}
                >
                  ×
                </button>
              </div>
              <NotationToolbar
                compact
                settings={settings}
                disabled={disabled}
                onChange={(next, field) => {
                  onSettings(next, field)
                  setPopover(null)
                  interaction.current?.focus({ preventScroll: true })
                }}
              />
            </div>
          )}
        </div>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          Score rendering failed: {error}
        </p>
      )}
      <footer className="score-footer">
        NOTATION <span>Interactive composition · Milestone 2B</span>
      </footer>
    </article>
  )
}
