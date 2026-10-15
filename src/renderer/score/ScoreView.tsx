import { useEffect, useRef, useState } from 'react'
import { Accidental, Barline, Beam, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow/bravura'
import type { Composition, Track } from '../../shared/composition'
import { measureEvents } from './measure'

const durations: Record<number, string> = { 1920: 'w', 960: 'h', 480: 'q', 240: '8', 120: '16' }

function Measure({ score, track, index }: { score: Composition; track: Track; index: number }) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError('')
    async function draw(): Promise<void> {
      try {
        // The bravura entry point embeds both fonts. No CDN or network access is required.
        await Promise.all([document.fonts.load('16px Bravura'), document.fonts.load('16px Academico')])
        if (cancelled || !container.current) return
        container.current.replaceChildren()
        const renderer = new Renderer(container.current, Renderer.Backends.SVG)
        renderer.resize(540, 200)
        const context = renderer.getContext()
        const stave = new Stave(12, 45, 512)
        stave.addClef(track.clef)
        if (index === 0) stave.addTimeSignature(`${score.timeSignature.numerator}/4`)
        if (index === score.measureCount - 1) stave.setEndBarType(Barline.type.END)
        stave.setContext(context).draw()
        const notes = measureEvents(score, track, index).map((event) => new StaveNote({
          clef: track.clef,
          keys: [event.kind === 'note'
            ? `${event.pitch.step.toLowerCase()}${event.pitch.accidental}/${event.pitch.octave}`
            : track.clef === 'bass' ? 'd/3' : 'b/4'],
          duration: `${durations[event.durationTicks]}${event.kind === 'rest' ? 'r' : ''}`,
          autoStem: true,
        }))
        const voice = new Voice({ numBeats: score.timeSignature.numerator, beatValue: 4 }).addTickables(notes)
        Accidental.applyAccidentals([voice], score.keySignature)
        const beams = Beam.generateBeams(notes)
        new Formatter().joinVoices([voice]).formatToStave([voice], stave)
        voice.draw(context, stave)
        beams.forEach((beam) => beam.setContext(context).draw())
        const svg = container.current.querySelector('svg')
        if (svg) {
          // VexFlow assigns fixed inline dimensions; let the measure card size its SVG.
          container.current.style.removeProperty('width')
          svg.style.removeProperty('width')
          svg.style.removeProperty('height')
          // Include ledger lines for unusually high/low imported pitches.
          const box = svg.getBBox()
          const top = Math.min(0, box.y - 12)
          const bottom = Math.max(170, box.y + box.height + 12)
          svg.setAttribute('viewBox', `0 ${top} 540 ${bottom - top}`)
          svg.setAttribute('role', 'img')
          svg.setAttribute('aria-label', `${track.name}, measure ${index + 1}`)
        }
        setReady(true)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to engrave this measure.')
      }
    }
    void draw()
    return () => { cancelled = true; container.current?.replaceChildren() }
  }, [score, track, index])
  return <>
    <div ref={container} className="engraving" data-render-state={ready ? 'ready' : 'loading'} />
    {error && <p role="alert">Score rendering failed: {error}</p>}
  </>
}

export function ScoreView({ score, selectedTrackId, selectedMeasure, onSelect }: {
  score: Composition
  selectedTrackId: string
  selectedMeasure: number
  onSelect(trackId: string, measure: number): void
}) {
  return <article className="score-page" aria-label="Sheet music">
    <header className="score-heading">
      <p className="eyebrow">FULL SCORE · {score.keySignature} MAJOR</p>
      <h2>{score.title}</h2>
      <p>♩ = {score.tempoBpm} <span>•</span> {score.timeSignature.numerator}/4</p>
    </header>
    {score.tracks.map((track) => <section className="score-part" key={track.id} aria-label={`${track.name} part`}>
      <h3>{track.name} <span>{track.clef} clef</span></h3>
      <div className="measure-grid">
        {Array.from({ length: score.measureCount }, (_, index) => <div key={index} className={`measure ${selectedTrackId === track.id && selectedMeasure === index ? 'selected' : ''}`}>
          <button className="measure-selector" aria-pressed={selectedTrackId === track.id && selectedMeasure === index}
            aria-label={`Select ${track.name} measure ${index + 1}`} onClick={() => onSelect(track.id, index)}>
            <span>MEASURE {String(index + 1).padStart(2, '0')}</span>
            <span>{selectedTrackId === track.id && selectedMeasure === index ? 'Editing' : 'Select'}</span>
          </button>
          <Measure score={score} track={track} index={index} />
        </div>)}
      </div>
    </section>)}
    <footer className="score-footer">NOTATION <span>Made for the music in your head.</span></footer>
  </article>
}
