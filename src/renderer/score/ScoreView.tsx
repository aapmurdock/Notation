import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ticksPerMeasure, type Composition, type Pitch } from '../../shared/composition'
import { NotationToolbar, type EntrySettings } from '../NotationToolbar'
import { engrave, type Engraving, type StaffMeasure } from './engrave'
import { pitchAtY, tickAtX, xForTick, yForPitch } from './geometry'

export interface ScoreCursor {
  trackId: string
  staffId: string
  tick: number
  pitch: Pitch
  eventId?: string
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
}: {
  score: Composition
  cursor: ScoreCursor
  settings: EntrySettings
  disabled: boolean
  onSelect(cursor: ScoreCursor): void
  onInsert(cursor: ScoreCursor, rest?: boolean): void
  onSettings(settings: EntrySettings): void
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
  const barTicks = ticksPerMeasure(score)

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
    popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const dismiss = (event: globalThis.PointerEvent): void => {
      if (!popoverRef.current?.contains(event.target as Node)) setPopover(null)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setPopover(null)
        interaction.current?.focus()
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
        measure.measure * barTicks,
        barTicks,
        settings.duration,
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
        Math.floor(cursor.tick / barTicks) === measure.measure &&
        !cursor.eventId
        ? cursor
        : {
            trackId: measure.trackId,
            staffId: measure.staffId,
            tick: measure.measure * barTicks,
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
  function selectEvent(measure: StaffMeasure, item: StaffMeasure['events'][number]): void {
    if (disabled) return
    interaction.current?.focus()
    setPopover(null)
    setPreview(null)
    onSelect({
      trackId: measure.trackId,
      staffId: measure.staffId,
      tick: item.event.startTick,
      pitch: item.event.kind === 'note' ? item.event.pitch : cursor.pitch,
      eventId: item.event.id,
    })
  }
  const cursorMeasure = layout?.measures.find(
    (measure) =>
      measure.staffId === cursor.staffId &&
      measure.measure === Math.min(score.measureCount - 1, Math.floor(cursor.tick / barTicks)),
  )
  const hovered =
    settings.mode === 'write' && !disabled && !drawing
      ? preview
        ? { ...preview, pitch: { ...preview.pitch, accidental: settings.accidental } }
        : cursorMeasure && !cursor.eventId && cursor.tick < score.measureCount * barTicks
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
  const selected = layout?.measures
    .flatMap((measure) => measure.events)
    .find(({ event }) => event.id === cursor.eventId)

  return (
    <article className="score-page" aria-label="Sheet music">
      <header className="score-heading">
        <p className="eyebrow">FULL SCORE · {score.keySignature} MAJOR</p>
        <h2>{score.title}</h2>
        <p>
          ♩ = {score.tempoBpm} <span>•</span> {score.timeSignature.numerator}/4
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
                        interaction.current?.focus()
                        setPopover(null)
                        const hit = target(event, measure)
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
                        aria-label={`${item.event.kind === 'note' ? `${item.event.pitch.step}${item.event.pitch.accidental}${item.event.pitch.octave} note` : 'Rest'}, ${measure.name} ${measure.clef}, measure ${measure.measure + 1}, beat ${(item.event.startTick % barTicks) / 480 + 1}`}
                        aria-pressed={item.event.id === cursor.eventId}
                        data-event-id={item.event.id}
                        data-tick={item.event.startTick}
                        x={item.x - 10}
                        y={item.y - 10}
                        width={28}
                        height={22}
                        fill="transparent"
                        onPointerMove={() => setPreview(null)}
                        onPointerDown={(event) => {
                          if (event.button === 0) {
                            event.stopPropagation()
                            event.preventDefault()
                            selectEvent(measure, item)
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
              {selected && (
                <ellipse
                  className="selected-entry"
                  pointerEvents="none"
                  cx={selected.x + 4}
                  cy={selected.y}
                  rx={13}
                  ry={11}
                />
              )}
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
                  {Array.from({ length: 10 }, (_, i) => [
                    hovered.measure.top - (i + 1) * 10,
                    hovered.measure.bottom + (i + 1) * 10,
                  ])
                    .flat()
                    .filter(
                      (y) =>
                        y >= Math.min(py, hovered.measure.top) &&
                        y <= Math.max(py, hovered.measure.bottom),
                    )
                    .map((y) => (
                      <line key={y} x1={px - 7} x2={px + 17} y1={y} y2={y} stroke="currentColor" />
                    ))}
                  {settings.rest ? (
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
                    {settings.rest
                      ? 'Rest'
                      : `${hovered.pitch.step}${hovered.pitch.accidental}${hovered.pitch.octave}`}{' '}
                    · beat {(hovered.tick % barTicks) / 480 + 1}
                  </text>
                </g>
              )}
            </svg>
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
                    interaction.current?.focus()
                  }}
                >
                  ×
                </button>
              </div>
              <NotationToolbar
                compact
                settings={settings}
                disabled={disabled}
                onChange={(next) => {
                  onSettings(next)
                  setPopover(null)
                  interaction.current?.focus()
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
        NOTATION <span>Continuous score · Milestone 2A</span>
      </footer>
    </article>
  )
}
