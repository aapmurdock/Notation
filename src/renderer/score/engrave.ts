import {
  Accidental,
  Barline,
  Beam,
  Formatter,
  Fraction,
  Dot,
  StaveTie,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from 'vexflow/bravura'
import {
  isDotted,
  baseDuration,
  type Composition,
  type ScoreEvent,
  type Staff,
  type Track,
} from '../../shared/composition'
import { bottomPitch, diatonic, planSystems, type TickAnchor } from './geometry'
import { measureEvents, type DisplayEvent } from './measure'
import {
  measureStart,
  measureTicks,
  resolvedPitch,
  signatureAt,
  timeName,
} from '../../shared/signatures'

const durations: Record<number, string> = {
  1920: 'w',
  960: 'h',
  480: 'q',
  240: '8',
  120: '16',
  60: '32',
}
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
  signatures: {
    kind: 'key' | 'time'
    x: number
    y: number
    width: number
    height: number
    empty: boolean
  }[]
}
export interface Engraving {
  width: number
  height: number
  measures: StaffMeasure[]
  systemCount: number
}

function createVoice(score: Composition, staff: Staff, measure: number) {
  const groups: DisplayEvent[][] = []
  for (const event of measureEvents(score, staff, measure)) {
    const previous = groups.at(-1)
    if (
      event.kind === 'note' &&
      previous?.[0]?.kind === 'note' &&
      previous[0].startTick === event.startTick
    )
      previous.push(event)
    else groups.push([event])
  }
  // VexFlow orders noteheads diatonically; keep that same order for per-tone hit testing/ties.
  for (const group of groups)
    group.sort((a, b) =>
      a.kind === 'note' && b.kind === 'note' ? diatonic(a.pitch) - diatonic(b.pitch) : 0,
    )
  const notes = groups.map((group) => {
    const event = group[0]!
    const note = new StaveNote({
      clef: staff.clef,
      keys: group.map((event) => {
        if (event.kind === 'rest') return staff.clef === 'bass' ? 'd/3' : 'b/4'
        const pitch = resolvedPitch(score, staff, event.startTick, event.pitch)
        return `${pitch.step.toLowerCase()}${pitch.accidental}/${pitch.octave}`
      }),
      duration: `${durations[baseDuration(event.durationTicks)]}${event.kind === 'rest' ? 'r' : ''}`,
      dots: isDotted(event.durationTicks) ? 1 : 0,
      alignCenter:
        event.kind === 'rest' &&
        !!event.implicit &&
        event.durationTicks === measureTicks(score, measure),
      autoStem: true,
    })
    if (isDotted(event.durationTicks)) Dot.buildAndAttach([note], { all: true })
    return note
  })
  const signature = signatureAt(score, measure)
  const voice = new Voice({
    numBeats: signature.timeSignature.numerator,
    beatValue: signature.timeSignature.denominator,
  }).addTickables(notes)
  Accidental.applyAccidentals([voice], signature.keySignature)
  return {
    voice,
    notes,
    groups,
    beams: Beam.generateBeams(
      notes,
      signature.timeSignature.denominator === 8 ? { groups: [new Fraction(3, 8)] } : {},
    ),
  }
}

/** Set the semantic clef without adding a repeated clef glyph to every measure. */
class ScoreStave extends Stave {
  constructor(clef: Staff['clef'], x: number, y: number, width: number) {
    super(x, y, width)
    this.clef = clef
  }
}

function makeStave(
  score: Composition,
  clef: Staff['clef'],
  measure: number,
  first: boolean,
  x: number,
  y: number,
  width: number,
): Stave {
  const stave = new ScoreStave(clef, x, y, width)
  if (first) stave.addClef(clef)
  const signature = signatureAt(score, measure)
  const previous = signatureAt(score, Math.max(0, measure - 1))
  if (first || signature.keySignature !== previous.keySignature)
    stave.addKeySignature(
      signature.keySignature,
      measure && signature.keySignature !== previous.keySignature
        ? previous.keySignature
        : undefined,
    )
  if (measure === 0 || timeName(signature.timeSignature) !== timeName(previous.timeSignature))
    stave.addTimeSignature(timeName(signature.timeSignature))
  return stave
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
      headers: {
        start: makeStave(score, 'treble', measure, true, 0, 0, 500).getNoteStartX() + 18,
        middle: makeStave(score, 'treble', measure, false, 0, 0, 500).getNoteStartX() + 18,
      },
      minimum: Math.max(
        112,
        formatter.preCalculateMinTotalWidth(voices.map((item) => item.voice)) + 34,
      ),
    }
  })
  const systems = planSystems(
    prepared.map((item) => item.minimum),
    availableWidth,
    prepared.map((item) => item.headers),
  )
  const width = systems[0]!.width
  const height = systems.length * systemHeight
  const renderer = new Renderer(container, Renderer.Backends.SVG)
  renderer.resize(width, height)
  const context = renderer.getContext()
  const measures: StaffMeasure[] = []
  const rendered = new Map<string, { note: StaveNote; index: number; system: number }>()

  systems.forEach((system, systemIndex) => {
    const group = context.openGroup('score-system')
    group.setAttribute('data-system-index', String(systemIndex))
    group.setAttribute('data-first-measure', String(system.columns[0]!.measure))
    group.setAttribute('data-measure-count', String(system.columns.length))
    const yOffset = systemIndex * systemHeight
    system.columns.forEach((column, columnIndex) => {
      const bar = prepared[column.measure]!
      const staves = rows.map((row) => {
        const stave = makeStave(
          score,
          row.staff.clef,
          column.measure,
          columnIndex === 0,
          column.x,
          row.top + yOffset - 40,
          column.width,
        )
        stave.setBegBarType(Barline.type.NONE)
        stave.setEndBarType(
          column.measure === score.measureCount - 1 ? Barline.type.END : Barline.type.SINGLE,
        )
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
      bar.voices.forEach(({ voice, notes, groups, beams }, rowIndex) => {
        const stave = staves[rowIndex]!
        voice.draw(context, stave)
        beams.forEach((beam) => beam.setContext(context).draw())
        const row = rows[rowIndex]!
        const engravedEvents: EngravedEvent[] = []
        notes.forEach((note, index) => {
          const group = groups[index]!
          const event = group[0]!
          // Whole-measure rests are visually centered, but their rhythmic tick remains at the start.
          tickXs.set(event.startTick, note.getAbsoluteX() - note.getCenterXShift())
          const svg = note.getSVGElement()
          svg?.setAttribute('data-tick', String(event.startTick))
          svg?.setAttribute('data-staff-id', row.staff.id)
          if (!event.implicit) {
            svg?.setAttribute('data-event-id', event.id)
            svg?.setAttribute('data-chord-size', String(group.length))
            const heads = svg?.querySelectorAll<SVGGraphicsElement>('.vf-notehead')
            for (const [toneIndex, tone] of group.entries()) {
              const head = heads?.[toneIndex]?.querySelector<SVGGraphicsElement>('text')?.getBBox()
              const box = note.getBoundingBox()
              rendered.set(tone.id, { note, index: toneIndex, system: systemIndex })
              engravedEvents.push({
                event: tone,
                x: head ? head.x + head.width / 2 - 4 : note.getAbsoluteX(),
                y: note.getYs()[toneIndex] ?? note.getYs()[0]!,
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
              })
            }
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
          signatures: (['key', 'time'] as const).map((kind) => {
            const modifier = stave
              .getModifiers()
              .find(
                (item) =>
                  item.getCategory() === (kind === 'key' ? 'KeySignature' : 'TimeSignature'),
              )
            const empty = !modifier || modifier.getWidth() === 0
            return {
              kind,
              x: modifier?.getX() ?? column.x + (kind === 'key' ? 5 : 27),
              y: empty ? stave.getYForLine(0) - 17 : stave.getYForLine(0) - 4,
              width: empty ? 20 : Math.max(16, modifier.getWidth()),
              height: empty ? 15 : 48,
              empty,
            }
          }),
        })
      })
      const endTick = measureStart(score, column.measure + 1)
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
  for (const track of score.tracks)
    for (const staff of track.staves)
      for (const event of staff.events)
        if (event.kind === 'note' && event.tieTo) {
          const from = rendered.get(event.id)!,
            to = rendered.get(event.tieTo)!
          const group = context.openGroup('notation-tie')
          group.setAttribute('data-from', event.id)
          group.setAttribute('data-to', event.tieTo)
          if (from.system === to.system) {
            new StaveTie({
              firstNote: from.note,
              lastNote: to.note,
              firstIndexes: [from.index],
              lastIndexes: [to.index],
            })
              .setContext(context)
              .draw()
          } else {
            new StaveTie({
              firstNote: from.note,
              firstIndexes: [from.index],
              lastIndexes: [from.index],
            })
              .setContext(context)
              .draw()
            new StaveTie({ lastNote: to.note, firstIndexes: [to.index], lastIndexes: [to.index] })
              .setContext(context)
              .draw()
          }
          context.closeGroup()
        }
  container.style.removeProperty('width')
  const svg = container.querySelector('svg')!
  svg.style.removeProperty('width')
  svg.style.removeProperty('height')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `Continuous score, ${systems.length} systems`)
  return { width, height, measures, systemCount: systems.length }
}
