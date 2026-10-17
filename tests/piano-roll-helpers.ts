import { expect, type Page, type Locator } from '@playwright/test'

export async function rollReady(page: Page) {
  await expect(page.locator('.piano-roll')).toHaveAttribute('data-render-state', 'ready')
  await expect(page.getByRole('alert')).toHaveCount(0)
}

/** Read the painted pitch row and timing grid, including native SVG transforms. */
export async function rollPoint(page: Page, tick: number, midi: number) {
  await page.locator('.roll-viewport').scrollIntoViewIfNeeded()
  await page.locator('.roll-viewport').evaluate(
    (viewport, { tick, midi }) => {
      const grid = viewport.querySelector<SVGSVGElement>('.roll-grid')!
      const row = grid.querySelector<SVGRectElement>(`.roll-pitch-row[data-midi="${midi}"]`)!
      const x = (tick * Number(grid.dataset.quarterWidth)) / 480
      const y = row.y.baseVal.value + row.height.baseVal.value / 2
      if (x < viewport.scrollLeft || x > viewport.scrollLeft + viewport.clientWidth - 100)
        viewport.scrollLeft = Math.max(0, x - viewport.clientWidth / 2)
      if (y < viewport.scrollTop + 40 || y > viewport.scrollTop + viewport.clientHeight - 30)
        viewport.scrollTop = Math.max(0, y - viewport.clientHeight / 2)
    },
    { tick, midi },
  )
  return page.locator('.roll-grid').evaluate(
    (grid, { tick, midi }) => {
      const svg = grid as SVGSVGElement
      const row = svg.querySelector<SVGRectElement>(`.roll-pitch-row[data-midi="${midi}"]`)!
      // The ruler has the same tick anchors as the grid; no editor pitch conversion is called.
      const quarter = svg.querySelector<SVGLineElement>('[data-grid-tick="480"]')!
      const x = (quarter.x1.baseVal.value * tick) / 480
      const point = new DOMPoint(
        x + 2,
        row.y.baseVal.value + row.height.baseVal.value / 2,
      ).matrixTransform(svg.getScreenCTM()!)
      return { x: point.x, y: point.y }
    },
    { tick, midi },
  )
}

export function block(page: Page, tick: number, midi: number): Locator {
  return page.locator(`.roll-note[data-start-tick="${tick}"][data-midi="${midi}"]`)
}

export async function dragBlock(
  page: Page,
  note: Locator,
  deltaTicks: number,
  semitones: number,
  resize = false,
  cancel = false,
) {
  const body = note.locator(resize ? '.roll-resize-handle' : '.roll-note-body')
  await body.scrollIntoViewIfNeeded()
  const box = (await body.boundingBox())!
  const scale = await page.locator('.roll-grid').evaluate((grid) => ({
    x:
      (Number((grid as SVGSVGElement).dataset.quarterWidth) *
        (grid as SVGSVGElement).getScreenCTM()!.a) /
      480,
    y:
      Number((grid as SVGSVGElement).dataset.rowHeight) * (grid as SVGSVGElement).getScreenCTM()!.d,
  }))
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaTicks * scale.x, y - semitones * scale.y)
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
}

export async function recordAudio(page: Page) {
  await page.addInitScript(() => {
    const frequencies: number[] = []
    Object.assign(window, { auditionFrequencies: frequencies })
    const original = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function () {
      const oscillator = original.call(this)
      const set = oscillator.frequency.setValueAtTime.bind(oscillator.frequency)
      oscillator.frequency.setValueAtTime = (value, time) => {
        frequencies.push(value)
        return set(value, time)
      }
      return oscillator
    }
  })
}
export async function midiNotes(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { auditionFrequencies: number[] }).auditionFrequencies.map((f) =>
      Math.round(69 + 12 * Math.log2(f / 440)),
    ),
  )
}
