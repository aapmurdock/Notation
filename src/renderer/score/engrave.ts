import {
  Accidental,
  Barline,
  Beam,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from 'vexflow/bravura'
import {
  ticksPerMeasure,
  type Composition,
  type ScoreEvent,
  type Staff,
  type Track,
} from '../../shared/composition'
import { bottomPitch, diatonic, planSystems, type TickAnchor } from './geometry'
import { measureEvents } from './measure'

const durations: Record<number, string> = { 1920: 'w', 960: 'h', 480: 'q', 240: '8', 120: '16' }
interface Row {
  track: Track
  staff: Staff
  top: number
  bottom: number
}
export interface EngravedEvent {
  event: ScoreEvent
  x: number
  y: number
  left: number
  top: number
  width: number
  height: number
}
export interface StaffMeasure {
  trackId: string
  staffId: string
  name: string
  clef: Staff['clef']
  measure: number
  system: number
  x: number
  width: number
  top: number
  bottom: number
  spacing: number
  anchors: TickAnchor[]
  events: EngravedEvent[]
}
export interface Engraving {
  width: number
  height: number
  measures: StaffMeasure[]
  systemCount: number
}

function createVoice(score: Composition, staff: Staff, measure: number) {
  const events = measureEvents(score, staff, measure)
  const notes = events.map(
    (event) =>
      new StaveNote({
        clef: staff.clef,
        keys: [
          event.kind === 'note'
            ? `${event.pitch.step.toLowerCase()}${event.pitch.accidental}/${event.pitch.octave}`
            : staff.clef === 'bass'
              ? 'd/3'
              : 'b/4',
        ],
        duration: `${durations[event.durationTicks]}${event.kind === 'rest' ? 'r' : ''}`,
        alignCenter:
          event.kind === 'rest' && event.implicit && event.durationTicks === ticksPerMeasure(score),
        autoStem: true,
      }),
  )
  const voice = new Voice({ numBeats: score.timeSignature.numerator, beatValue: 4 }).addTickables(
    notes,
  )
  Accidental.applyAccidentals([voice], score.keySignature)
  return { voice, notes, events, beams: Beam.generateBeams(notes) }
}

function staffRows(score: Composition): { rows: Row[]; height: number } {
  const rows: Row[] = []
  let y = 38
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      const pitches = staff.events.flatMap((event) =>
        event.kind === 'note' ? [diatonic(event.pitch)] : [],
      )
      const bottom = bottomPitch(staff.clef)
      const above = Math.max(24, (Math.max(bottom + 8, ...pitches) - bottom - 8) * 5 + 18)
      const below = Math.max(24, (bottom - Math.min(bottom, ...pitches)) * 5 + 18)
      const top = y + above
      rows.push({ track, staff, top, bottom: top + 40 })
      y = top + 40 + below + 34
    }
    y += 20
  }
  return { rows, height: y + 18 }
}

/** One SVG and one shared rhythmic formatter per measure, spanning all instrument staves. */
export function engrave(
  container: HTMLDivElement,
  score: Composition,
  availableWidth: number,
): Engraving {
  container.replaceChildren()
  const { rows, height: systemHeight } = staffRows(score)
  // Compute required space from all parts together, not from a fixed measure count.
  const prepared = Array.from({ length: score.measureCount }, (_, measure) => {
    const voices = rows.map(({ staff }) => createVoice(score, staff, measure))
    const formatter = new Formatter()
    for (const { voice } of voices) formatter.joinVoices([voice])
    return {
      voices,
      minimum: Math.max(
        112,
        formatter.preCalculateMinTotalWidth(voices.map((item) => item.voice)) + 34,
      ),
    }
  })
  const systems = planSystems(
    prepared.map((item) => item.minimum),
    availableWidth,
  )
  const width = systems[0]!.width
  const height = systems.length * systemHeight
  const renderer = new Renderer(container, Renderer.Backends.SVG)
  renderer.resize(width, height)
  const context = renderer.getContext()
  const measures: StaffMeasure[] = []
  const barTicks = ticksPerMeasure(score)

  systems.forEach((system, systemIndex) => {
    const group = context.openGroup('score-system')
    group.setAttribute('data-system-index', String(systemIndex))
    group.setAttribute('data-first-measure', String(system.columns[0]!.measure))
    group.setAttribute('data-measure-count', String(system.columns.length))
    const yOffset = systemIndex * systemHeight
    system.columns.forEach((column, columnIndex) => {
      const bar = prepared[column.measure]!
      const staves = rows.map((row) => {
        const stave = new Stave(column.x, row.top + yOffset - 40, column.width)
        stave.setBegBarType(Barline.type.NONE)
        stave.setEndBarType(
          column.measure === score.measureCount - 1 ? Barline.type.END : Barline.type.SINGLE,
        )
        if (columnIndex === 0) stave.addClef(row.staff.clef)
        if (column.measure === 0) stave.addTimeSignature(`${score.timeSignature.numerator}/4`)
        return stave
      })
      Stave.formatBegModifiers(staves)
      const startX = Math.max(...staves.map((stave) => stave.getNoteStartX()))
      staves.forEach((stave, index) => {
        stave.setNoteStartX(startX).setContext(context).draw()
        const element = stave.getSVGElement()
        element?.setAttribute('data-staff-id', rows[index]!.staff.id)
        element?.setAttribute('data-measure', String(column.measure))
        element?.setAttribute('data-system', String(systemIndex))
        bar.voices[index]!.voice.setStave(stave)
        bar.voices[index]!.notes.forEach((note) => note.setStave(stave))
      })
      const formatter = new Formatter()
      bar.voices.forEach(({ voice }) => formatter.joinVoices([voice]))
      formatter.formatToStave(
        bar.voices.map(({ voice }) => voice),
        staves[0]!,
        { context },
      )
      const tickXs = new Map<number, number>()
      bar.voices.forEach(({ voice, notes, events, beams }, rowIndex) => {
        const stave = staves[rowIndex]!
        voice.draw(context, stave)
        beams.forEach((beam) => beam.setContext(context).draw())
        const row = rows[rowIndex]!
        const engravedEvents: EngravedEvent[] = []
        notes.forEach((note, index) => {
          const event = events[index]!
          // Whole-measure rests are visually centered, but their rhythmic tick remains at the start.
          tickXs.set(event.startTick, note.getAbsoluteX() - note.getCenterXShift())
          const svg = note.getSVGElement()
          svg?.setAttribute('data-tick', String(event.startTick))
          svg?.setAttribute('data-staff-id', row.staff.id)
          if (!event.implicit) {
            svg?.setAttribute('data-event-id', event.id)
            const box = note.getBoundingBox()
            engravedEvents.push({
              event,
              x: note.getAbsoluteX(),
              y: note.getYs()[0]!,
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
            })
          }
        })
        measures.push({
          trackId: row.track.id,
          staffId: row.staff.id,
          name: row.track.name,
          clef: row.staff.clef,
          measure: column.measure,
          system: systemIndex,
          x: column.x,
          width: column.width,
          top: stave.getYForLine(0),
          bottom: stave.getYForLine(4),
          spacing: stave.getSpacingBetweenLines(),
          anchors: [],
          events: engravedEvents,
        })
      })
      const endTick = (column.measure + 1) * barTicks
      tickXs.set(endTick, staves[0]!.getNoteEndX() - 10)
      const anchors = [...tickXs].map(([tick, x]) => ({ tick, x })).sort((a, b) => a.tick - b.tick)
      for (const measure of measures.slice(-rows.length)) measure.anchors = anchors

      // Connect grand staves at every barline and brace them at the start of each system.
      score.tracks.forEach((track) => {
        const indexes = rows.flatMap((row, index) => (row.track.id === track.id ? [index] : []))
        const upper = staves[indexes[0]!]!
        const lower = staves[indexes.at(-1)!]!
        if (track.staves.length === 2) {
          if (columnIndex === 0) {
            const braceGroup = context.openGroup('piano-brace')
            braceGroup.setAttribute('data-part-id', track.id)
            new StaveConnector(upper, lower).setType('brace').setContext(context).draw()
            context.closeGroup()
          }
          new StaveConnector(upper, lower)
            .setType(column.measure === score.measureCount - 1 ? 'boldDoubleRight' : 'singleRight')
            .setContext(context)
            .draw()
        }
        if (columnIndex === 0) {
          context.save()
          context.setFont('Academico', 11)
          context.fillText(
            track.name.length > 12 ? track.name.slice(0, 11) + '…' : track.name,
            4,
            (upper.getYForLine(0) + lower.getYForLine(4)) / 2 + 4,
          )
          context.restore()
        }
      })
      if (columnIndex === 0)
        new StaveConnector(staves[0]!, staves.at(-1)!)
          .setType('singleLeft')
          .setContext(context)
          .draw()
      // Measure numbers belong to the system, not separate cards.
      context.save()
      context.setFont('Academico', 10)
      context.fillText(String(column.measure + 1), column.x + 5, staves[0]!.getYForLine(0) - 20)
      context.restore()
    })
    context.closeGroup()
  })
  container.style.removeProperty('width')
  const svg = container.querySelector('svg')!
  svg.style.removeProperty('width')
  svg.style.removeProperty('height')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `Continuous score, ${systems.length} systems`)
  return { width, height, measures, systemCount: systems.length }
}
