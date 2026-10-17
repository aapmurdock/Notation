import { expect, test } from '@playwright/test'
import { ready, staffPoint } from '../score-helpers'
import {
  block,
  dragBlock,
  midiNotes,
  recordAudio,
  rollPoint,
  rollReady,
} from '../piano-roll-helpers'

for (const zoom of [50, 100, 200]) {
  test(`piano roll inserts, moves, resizes and cancels at ${zoom}% timeline zoom`, async ({
    page,
  }) => {
    await recordAudio(page)
    await page.goto('/')
    await ready(page)
    await page.getByRole('button', { name: 'New score', exact: true }).click()
    await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
    await rollReady(page)
    if (zoom === 50) await page.getByRole('button', { name: 'Zoom timeline out' }).click()
    if (zoom === 200) await page.getByRole('button', { name: 'Zoom timeline in' }).click()
    await page.getByRole('combobox', { name: 'Piano roll snap' }).selectOption('60')
    await page.getByRole('button', { name: 'Thirty-second duration', exact: true }).click()
    const point = await rollPoint(page, 60, 61)
    await page.mouse.click(point.x, point.y)
    const original = block(page, 60, 61)
    await expect(original).toHaveAttribute('data-duration', '60')
    const id = await original.getAttribute('data-event-id')
    const staff = await original.getAttribute('data-staff-id')
    await expect.poll(() => midiNotes(page)).toEqual([61])
    await dragBlock(page, original, 120, 2)
    const moved = block(page, 180, 63)
    await expect(moved).toHaveAttribute('data-event-id', id!)
    await expect(moved).toHaveAttribute('data-staff-id', staff!)
    await expect(moved).toHaveAttribute('data-velocity', '80')
    await expect.poll(() => midiNotes(page)).toEqual([61, 63])
    await dragBlock(page, moved, 180, 0, true)
    await expect(moved).toHaveAttribute('data-duration', '240')
    await dragBlock(page, moved, 60, 1, false, true)
    await expect(moved).toHaveAttribute('data-duration', '240')
    await expect(block(page, 240, 64)).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(moved).toHaveAttribute('data-duration', '60')
    await page.keyboard.press('Control+y')
    await expect(moved).toHaveAttribute('data-duration', '240')
    await page.getByRole('tab', { name: 'Notation', exact: true }).click()
    await ready(page)
    await expect(page.locator(`.event-hit[data-event-id="${id}"]`)).toHaveAttribute(
      'data-tick',
      '180',
    )
    await expect(page.locator(`.event-hit[data-event-id="${id}"]`)).toHaveAttribute(
      'data-duration',
      '240',
    )
    await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
    await expect(moved.locator('.roll-note-body')).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('tab', { name: 'Piano roll', exact: true }).focus()
    await page.keyboard.press('ArrowLeft')
    await ready(page)
    await page.keyboard.press('ArrowRight')
    await expect(moved.locator('.roll-note-body')).toHaveAttribute('aria-pressed', 'true')
  })
}

test('all snap grids update without quantizing; keyboard audition and stable drag pitches', async ({
  page,
}) => {
  await recordAudio(page)
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
  await rollReady(page)
  await page.getByRole('button', { name: 'Audition C4, MIDI 60', exact: true }).click()
  await expect.poll(() => midiNotes(page)).toEqual([60])
  await page.getByRole('button', { name: 'Thirty-second duration', exact: true }).click()
  for (const [index, snap] of [480, 240, 120, 60].entries()) {
    await page.getByRole('combobox', { name: 'Piano roll snap' }).selectOption(String(snap))
    await expect(page.locator('.roll-grid')).toHaveAttribute('data-snap', String(snap))
    const point = await rollPoint(page, snap * 1.3, 60 + index)
    await page.mouse.click(point.x, point.y)
    await expect(block(page, snap, 60 + index)).toHaveAttribute('data-duration', '60')
  }
  await expect(page.locator('.roll-note')).toHaveCount(4)
  await page.getByRole('combobox', { name: 'Piano roll snap' }).selectOption('480')
  await expect(block(page, 60, 63)).toHaveAttribute('data-duration', '60')
  const note = block(page, 60, 63)
  const body = note.locator('.roll-note-body')
  const box = (await body.boundingBox())!
  const row = Number(await page.locator('.roll-grid').getAttribute('data-row-height'))
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - row)
  const count = (await midiNotes(page)).length
  for (const jitter of [0.2, 0.4, 0.1, 0.3])
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - row + jitter)
  expect((await midiNotes(page)).length).toBe(count)
  await page.mouse.up()
  await expect(block(page, 60, 64)).toHaveCount(1) // vertical-only move preserves fine timing
})

test('both piano staves, instrument context, multi-selection, ownership correction and shared history', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  await expect(page.getByRole('heading', { name: 'Active staff' })).toHaveCount(0)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await page.getByRole('combobox', { name: 'New part instrument' }).selectOption('1')
  await page.getByRole('button', { name: '+ Add part', exact: true }).click()
  await ready(page)
  const point = await staffPoint(page, 'bass', 1, 3)
  await page.mouse.click(point.x, point.y)
  await ready(page)
  const treblePoint = await staffPoint(page, 'treble', 1, 0)
  await page.mouse.click(treblePoint.x, treblePoint.y)
  await ready(page)
  await expect(page.locator('.cursor-status')).toContainText('Piano · treble')
  await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
  await expect(block(page, 0, 48)).toHaveCount(1)
  await expect(block(page, 0, 64)).toHaveCount(1)
  const bassStaff = await block(page, 0, 48).getAttribute('data-staff-id')
  await dragBlock(page, block(page, 0, 48), 0, 14)
  await expect(block(page, 0, 62)).toHaveAttribute('data-staff-id', bassStaff!)
  await page.getByRole('button', { name: 'Assign selected notes to treble', exact: true }).click()
  expect(await block(page, 0, 62).getAttribute('data-staff-id')).not.toBe(bassStaff)
  await page.locator('.part-button').filter({ hasText: 'Violin' }).click()
  await expect(page.locator('.roll-note')).toHaveCount(0)
  const violin = await rollPoint(page, 480, 67)
  await page.mouse.click(violin.x, violin.y)
  await expect(block(page, 480, 67)).toHaveCount(1)
  await page.locator('.part-button').filter({ hasText: 'Piano' }).click()
  await expect(page.locator('.roll-note')).toHaveCount(2)
  await block(page, 0, 62).locator('.roll-note-body').click()
  await block(page, 0, 64)
    .locator('.roll-note-body')
    .click({ modifiers: ['Control'] })
  await expect(page.locator('.roll-note.selected')).toHaveCount(2)
  await page.keyboard.press('Delete')
  await expect(page.locator('.roll-note')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.roll-note')).toHaveCount(2)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  const blank = await rollPoint(page, 960, 55)
  await page.mouse.click(blank.x, blank.y)
  await expect(page.locator('.roll-note.selected')).toHaveCount(0)
  const start = await rollPoint(page, 0, 66),
    end = await rollPoint(page, 600, 60)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y)
  await page.mouse.up()
  await expect(page.locator('.roll-note.selected')).toHaveCount(2)
})

test('cross-bar sustains engrave as ties; chord edits reject independent overlaps safely', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
  await page.getByRole('combobox', { name: 'Piano roll snap' }).selectOption('60')
  const position = await rollPoint(page, 1860, 60)
  await page.mouse.click(position.x, position.y)
  const sustained = block(page, 1860, 60)
  const id = await sustained.getAttribute('data-event-id')
  await expect(sustained).toHaveAttribute('data-duration', '480')
  await page.getByRole('tab', { name: 'Notation', exact: true }).click()
  await ready(page)
  await expect(page.locator(`.event-hit[data-event-id="${id}"]`)).toHaveCount(3)
  expect(await page.locator('.vf-notation-tie path').count()).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.vf-piano-brace')).toHaveCount(
    await page.locator('.vf-score-system').count(),
  )
  await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
  await expect(page.locator('.roll-note')).toHaveCount(1)
  const chord = await rollPoint(page, 1860, 64)
  await page.mouse.click(chord.x, chord.y)
  await expect(page.locator('.roll-note')).toHaveCount(2)
  await dragBlock(page, block(page, 1860, 64), 60, 0)
  await expect(page.getByRole('alert')).toContainText('Overlapping')
  await expect(block(page, 1860, 64)).toHaveCount(1)
  await page.getByRole('button', { name: 'Select chord / ties', exact: true }).click()
  await page.keyboard.press('ArrowRight')
  await expect(block(page, 1920, 64)).toHaveCount(1)
  await expect(block(page, 1920, 60)).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('piano-roll.png'), fullPage: true })
})

test('thirty-second flags, rests and beams render; compound meter and key-aware roll entry synchronize', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await page.getByRole('complementary').getByLabel('Time signature').selectOption('6/8')
  await page.getByRole('complementary').getByLabel('Key signature').selectOption('G')
  await page.getByRole('button', { name: 'Apply signatures', exact: true }).click()
  await ready(page)
  await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
  await page.getByRole('combobox', { name: 'Piano roll snap' }).selectOption('60')
  await page.getByRole('button', { name: 'Thirty-second duration', exact: true }).click()
  for (const tick of [0, 60, 180]) {
    const point = await rollPoint(page, tick, 66)
    await page.mouse.click(point.x, point.y)
    await expect(block(page, tick, 66)).toHaveAttribute('data-duration', '60')
  }
  // F-sharp follows G major without an explicit override; the roll displays chromatic pitch.
  await expect(block(page, 0, 66).locator('.roll-note-body')).toHaveAttribute(
    'aria-label',
    'F4 note, Piano treble, tick 0',
  )
  const staffIds = await page
    .locator('.roll-note')
    .evaluateAll((notes) => notes.map((note) => note.getAttribute('data-staff-id')))
  expect(new Set(staffIds).size).toBe(1)
  await page.getByRole('tab', { name: 'Notation', exact: true }).click()
  await ready(page)
  await expect(page.locator('.event-hit[data-duration="60"]')).toHaveCount(3)
  // SMuFL: thirty-second rests use E4E8; flagged thirty-seconds use E244/E245.
  const glyphs = await page.locator('.engraving text').allTextContents()
  expect(glyphs.join('')).toContain('\uE4E8')
  expect(await page.locator('.engraving .vf-beam').count()).toBeGreaterThan(0)
  // An isolated thirty-second in bass gets the actual triple flag.
  const bass = await staffPoint(page, 'bass', 1, 3)
  await page.mouse.click(bass.x, bass.y)
  await ready(page)
  const flags = (await page.locator('.engraving text').allTextContents()).join('')
  expect(flags.includes('\uE244') || flags.includes('\uE245')).toBe(true)
  await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
  await expect(block(page, 0, 48)).toHaveCount(1)
  await expect(page.locator('.roll-ruler [data-tick="720"]')).toHaveAttribute(
    'data-kind',
    'compound',
  )
  await expect(page.locator('.roll-ruler [data-tick="1440"]')).toHaveAttribute(
    'data-kind',
    'measure',
  )
})

test('overlapping unisons on separate piano staves remain individually clickable', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
  const point = await rollPoint(page, 0, 60)
  await page.mouse.click(point.x, point.y)
  await page.locator('.roll-grid').focus()
  await page.keyboard.press('Escape')
  await page.getByRole('combobox', { name: 'New-note staff', exact: true }).selectOption('bass')
  // Keyboard insertion at the editing cursor permits a second staff's unison at the same onset.
  await page.locator('.roll-grid').focus()
  await page.keyboard.press('Enter')
  const unisons = page.locator('.roll-note[data-midi="60"]')
  await expect(unisons).toHaveCount(2)
  const treble = unisons.filter({ has: page.locator('.roll-note-body[aria-label*="treble"]') })
  const bass = unisons.filter({ has: page.locator('.roll-note-body[aria-label*="bass"]') })
  await treble.locator('.roll-note-body').click()
  await expect(treble.locator('.roll-note-body')).toHaveAttribute('aria-pressed', 'true')
  await bass.locator('.roll-note-body').click()
  await expect(bass.locator('.roll-note-body')).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Delete')
  await expect(unisons).toHaveCount(1)
  await expect(treble).toHaveCount(1)
})
