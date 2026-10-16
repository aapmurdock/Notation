import { expect, test } from '@playwright/test'
import { ready, selectMeasure, staffPoint } from '../score-helpers'

test('draws continuous grand staff systems with real aligned staff lines and responsive wrapping', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  )
  await page.goto('/')
  await ready(page)
  await expect(page.locator('.engraving > svg')).toHaveCount(1)
  // Clefs repeat only at system starts, never twice or at every barline.
  const clefs = await page.locator('.engraving text').allTextContents()
  const initialSystems = await page.locator('.vf-score-system').count()
  expect(clefs.filter((text) => text === '\uE050')).toHaveLength(initialSystems)
  expect(clefs.filter((text) => text === '\uE062')).toHaveLength(initialSystems)
  const wideSystems = await page.locator('.vf-score-system').count()
  expect(await page.evaluate(() => document.fonts.check('16px Bravura'))).toBe(true)
  await page.getByLabel('New part instrument').selectOption({ label: 'Violin' })
  await page.getByRole('button', { name: '+ Add part' }).click()
  await ready(page)

  // Inspect the paths VexFlow actually drew, not CSS boxes or layout metadata.
  const staves = await page.locator('.engraving .vf-stave').evaluateAll((groups) =>
    groups.map((group) => ({
      staff: group.getAttribute('data-staff-id'),
      measure: Number(group.getAttribute('data-measure')),
      system: Number(group.getAttribute('data-system')),
      lines: Array.from(group.querySelectorAll('path')).map((path) => {
        const line = path as SVGPathElement
        const first = line.getPointAtLength(0),
          last = line.getPointAtLength(line.getTotalLength())
        return { x1: first.x, x2: last.x, y: first.y }
      }),
    })),
  )
  expect(staves).toHaveLength(12)
  for (const stave of staves) {
    expect(stave.lines).toHaveLength(5)
    const next = staves.find(
      (other) =>
        other.staff === stave.staff &&
        other.system === stave.system &&
        other.measure === stave.measure + 1,
    )
    if (next)
      for (let line = 0; line < 5; line++) {
        expect(stave.lines[line]!.x2).toBeCloseTo(next.lines[line]!.x1, 0)
        expect(stave.lines[line]!.y).toBeCloseTo(next.lines[line]!.y)
      }
    for (const aligned of staves.filter(
      (other) => other.system === stave.system && other.measure === stave.measure,
    )) {
      expect(stave.lines[0]!.x1).toBeCloseTo(aligned.lines[0]!.x1)
      expect(stave.lines[0]!.x2).toBeCloseTo(aligned.lines[0]!.x2)
    }
  }
  await expect(page.locator('.vf-piano-brace')).toHaveCount(
    await page.locator('.vf-score-system').count(),
  )
  await page.screenshot({ path: testInfo.outputPath('continuous-score-wide.png'), fullPage: true })
  await page.setViewportSize({ width: 900, height: 1000 })
  await expect.poll(() => page.locator('.vf-score-system').count()).toBeGreaterThan(wideSystems)
  await ready(page)
  await expect(page.locator('.engraving > svg')).toHaveCount(1)
  await page.screenshot({
    path: testInfo.outputPath('continuous-score-narrow.png'),
    fullPage: true,
  })
  expect(errors).toEqual([])
})

test('previews and inserts pitches independently on piano staves, then selects and deletes a note', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score' }).click()
  await ready(page)
  const treble = await staffPoint(page, 'treble', 1, 0) // bottom line E4
  await page.mouse.move(treble.x, treble.y)
  await expect(page.locator('.note-preview')).toHaveAttribute('data-preview-pitch', 'E4')
  await expect(page.locator('.note-preview')).toHaveAttribute('data-preview-tick', '0')
  await page.mouse.click(treble.x, treble.y)
  await ready(page)
  await expect(
    page.getByRole('button', { name: 'E4 note, Piano treble, measure 1, beat 1', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.cursor-status')).toContainText('Measure 1, beat 2')

  // A duration change in the active measure must preserve the advancing caret.
  const blank = await staffPoint(page, 'treble', 1, 0, 0.6)
  await page.mouse.click(blank.x, blank.y, { button: 'right' })
  await page
    .getByRole('dialog', { name: 'Measure entry options' })
    .getByRole('button', { name: 'Eighth duration' })
    .click()
  await expect(page.locator('.cursor-status')).toContainText('Measure 1, beat 2')

  // Use the contextual duration control without going back to the sidebar.
  await page.getByRole('button', { name: 'Select Piano bass measure 1', exact: true }).click()
  const popup = page.getByRole('dialog', { name: 'Measure entry options' })
  await popup.getByRole('button', { name: 'Half duration' }).click()
  await expect(popup).toHaveCount(0)
  const bass = await staffPoint(page, 'bass', 1, 3) // C3, two spaces above G2
  await page.mouse.move(bass.x, bass.y)
  await expect(page.locator('.note-preview')).toHaveAttribute('data-preview-pitch', 'C3')
  await page.mouse.click(bass.x, bass.y)
  await ready(page)
  await expect(
    page.getByRole('button', { name: 'C3 note, Piano bass, measure 1, beat 1', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.cursor-status')).toContainText('Piano · bass · Measure 1, beat 3')
  const alignedHeads = await page
    .locator('.engraving .vf-stavenote[data-event-id][data-tick="0"] .vf-notehead')
    .evaluateAll((heads) =>
      heads.map((head) => {
        const box = (head as SVGGraphicsElement).getBBox()
        return box.x + box.width / 2
      }),
    )
  expect(alignedHeads).toHaveLength(2)
  // Different notehead glyphs have slightly different optical bounds.
  expect(Math.abs(alignedHeads[0]! - alignedHeads[1]!)).toBeLessThanOrEqual(1)
  const note = page.getByRole('button', {
    name: 'E4 note, Piano treble, measure 1, beat 1',
    exact: true,
  })
  await note.click()
  await expect(note).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Delete')
  await ready(page)
  await expect(note).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'C3 note, Piano bass, measure 1, beat 1', exact: true }),
  ).toBeVisible()
})

test('keyboard entry advances by duration, rejects bar crossings, and keeps metadata typing separate', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score' }).click()
  await ready(page)
  await selectMeasure(page, 'treble')
  await page.keyboard.press('3') // quarter
  for (const key of ['c', 'd', 'e']) {
    await page.keyboard.press(key)
    await ready(page)
  }
  await expect(page.locator('.cursor-status')).toContainText('Measure 1, beat 4')
  await page.keyboard.press('2') // half won't fit at beat 4
  await page.keyboard.press('f')
  await expect(page.getByRole('alert')).toContainText('crosses the barline')
  await page.keyboard.press('3')
  await page.keyboard.press('f')
  await ready(page)
  await expect(page.locator('.cursor-status')).toContainText('Measure 2, beat 1')
  await page.keyboard.press('4')
  await page.keyboard.press('g')
  await ready(page)
  await expect(page.locator('.cursor-status')).toContainText('Measure 2, beat 1.5')
  await page.keyboard.press('0')
  await ready(page)
  await expect(
    page.getByRole('button', { name: 'Rest, Piano treble, measure 2, beat 1.5', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('5')
  await page.keyboard.press('a')
  await ready(page)
  await expect(page.locator('.cursor-status')).toContainText('Measure 2, beat 2.25')
  await page.getByLabel('Title').fill('ABC 123')
  await page.getByLabel('Title').press('Enter')
  await ready(page)
  await expect(page.getByRole('heading', { name: 'ABC 123' })).toBeVisible()
  await expect(page.locator('.event-hit')).toHaveCount(7)
})
