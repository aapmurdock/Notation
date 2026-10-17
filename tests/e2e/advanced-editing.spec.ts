import { expect, test, type Page } from '@playwright/test'
import { ready, staffPoint, selectMeasure } from '../score-helpers'

/** Spy on actual Web Audio scheduling rather than adding a production test API. */
async function recordAudio(page: Page) {
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
async function midiNotes(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { auditionFrequencies: number[] }).auditionFrequencies.map((frequency) =>
      Math.round(69 + 12 * Math.log2(frequency / 440)),
    ),
  )
}

for (const { clef, steps, pitch, dragged, midi, nextMidi } of [
  { clef: 'treble', steps: 0, pitch: 'E4', dragged: 'F4', midi: 64, nextMidi: 65 },
  { clef: 'bass', steps: 3, pitch: 'C3', dragged: 'D3', midi: 48, nextMidi: 50 },
] as const) {
  test(`${clef} insertion auditions; drag snaps, commits once, and Escape cancels`, async ({
    page,
  }) => {
    await recordAudio(page)
    await page.goto('/')
    await ready(page)
    await page.getByRole('button', { name: 'New score', exact: true }).click()
    await ready(page)
    const point = await staffPoint(page, clef, 1, steps)
    await page.mouse.click(point.x, point.y)
    await ready(page)
    await expect.poll(() => midiNotes(page)).toEqual([midi])
    const original = page.getByRole('button', {
      name: `${pitch} note, Piano ${clef}, measure 1, beat 1`,
      exact: true,
    })
    const id = await original.getAttribute('data-event-id')
    const box = (await original.boundingBox())!
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y - 5)
    await expect.poll(() => midiNotes(page)).toEqual([midi, nextMidi])
    for (const offset of [5.2, 5.6, 6, 5]) await page.mouse.move(x, y - offset)
    expect(await midiNotes(page)).toEqual([midi, nextMidi])
    // The canonical score has not changed yet.
    await expect(original).toHaveCount(1)
    await expect(page.locator('.note-preview')).toHaveAttribute('data-preview-pitch', dragged)
    await page.mouse.up()
    await ready(page)
    const edited = page.getByRole('button', {
      name: `${dragged} note, Piano ${clef}, measure 1, beat 1`,
      exact: true,
    })
    await expect(edited).toHaveAttribute('data-event-id', id!)
    await expect(edited).toHaveAttribute('data-tick', '0')
    const nextBox = (await edited.boundingBox())!
    await page.mouse.move(nextBox.x + nextBox.width / 2, nextBox.y + nextBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(nextBox.x + 12, nextBox.y - 10)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await ready(page)
    await expect(edited).toHaveCount(1)
    await expect(page.locator('.event-hit')).toHaveCount(1)
    const beforeLedger = (await edited.boundingBox())!
    const offset = clef === 'treble' ? 15 : 30 // F4 -> C4, or D3 -> E2
    const ledgerPitch = clef === 'treble' ? 'C4' : 'E2'
    await page.mouse.move(
      beforeLedger.x + beforeLedger.width / 2,
      beforeLedger.y + beforeLedger.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      beforeLedger.x + beforeLedger.width / 2 + 40,
      beforeLedger.y + beforeLedger.height / 2 + offset,
    )
    await page.mouse.up()
    await ready(page)
    const ledger = page.getByRole('button', {
      name: `${ledgerPitch} note, Piano ${clef}, measure 1, beat 1`,
      exact: true,
    })
    await expect(ledger).toHaveAttribute('data-tick', '0')
    await expect(ledger).toHaveAttribute('data-duration', '480')
    await page.keyboard.press('Control+z')
    await ready(page)
    await expect(edited).toBeVisible()
  })
}

test('staff key/time editors synchronize with the sidebar and audition key-aware pitches', async ({
  page,
}) => {
  await recordAudio(page)
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await ready(page)
  await page
    .getByRole('button', { name: 'Key signature, Piano treble, measure 1: C major', exact: true })
    .click()
  const keyDialog = page.getByRole('dialog', { name: 'Key signature editor' })
  await keyDialog.getByLabel('Key signature').selectOption('G')
  await keyDialog.getByRole('button', { name: 'Apply key signature', exact: true }).click()
  await ready(page)
  await expect(page.getByRole('complementary').getByLabel('Key signature')).toHaveValue('G')
  // F on the bottom treble space sounds F-sharp in G major.
  const point = await staffPoint(page, 'treble', 1, 1)
  await page.mouse.click(point.x, point.y)
  await ready(page)
  await expect.poll(() => midiNotes(page)).toEqual([66])
  await page
    .getByRole('button', { name: 'F4 note, Piano treble, measure 1, beat 1', exact: true })
    .click()
  await page.getByRole('button', { name: 'Natural accidental', exact: true }).click()
  await ready(page)
  await expect.poll(() => midiNotes(page)).toEqual([66, 65])
  await expect(
    page.getByRole('button', { name: 'F♮4 note, Piano treble, measure 1, beat 1', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Time signature, Piano treble, measure 1: 4/4', exact: true })
    .click()
  const timeDialog = page.getByRole('dialog', { name: 'Time signature editor' })
  await timeDialog.getByLabel('Time signature').selectOption('6/8')
  await timeDialog.getByRole('button', { name: 'Apply time signature', exact: true }).click()
  await ready(page)
  await expect(page.getByRole('complementary').getByLabel('Time signature')).toHaveValue('6/8')
  await expect(
    page.getByRole('button', { name: 'F♮4 note, Piano treble, measure 1, beat 1', exact: true }),
  ).toBeVisible()
  await page.getByRole('complementary').getByLabel('Key signature').selectOption('Dm')
  await page.getByRole('button', { name: 'Apply signatures', exact: true }).click()
  await ready(page)
  await expect(
    page.getByRole('button', {
      name: 'Key signature, Piano bass, measure 1: D minor',
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.locator('.vf-piano-brace')).toHaveCount(
    await page.locator('.vf-score-system').count(),
  )
})

test('edits chord durations, dots, accidentals, selections, deletion, and undo/redo directly', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await ready(page)
  await page.getByRole('button', { name: 'Chord entry', exact: true }).click()
  await selectMeasure(page, 'treble')
  for (const key of ['c', 'e', 'g']) {
    await page.keyboard.press(key)
    await ready(page)
  }
  await expect(page.locator('.event-hit')).toHaveCount(3)
  await expect(
    page.locator('.engraving .vf-stavenote[data-chord-size="3"] .vf-notehead'),
  ).toHaveCount(3)
  const c = page.getByRole('button', {
    name: 'C4 note, Piano treble, measure 1, beat 1',
    exact: true,
  })
  await c.click()
  await page.getByRole('button', { name: 'Select chord / ties', exact: true }).click()
  await page.getByRole('button', { name: 'Dotted duration', exact: true }).click()
  await ready(page)
  await expect(page.locator('.event-hit[data-duration="720"]')).toHaveCount(3)
  expect(
    await page
      .locator('.engraving .vf-stavenote[data-chord-size="3"] .vf-notehead text')
      .allTextContents(),
  ).toEqual(expect.arrayContaining(['\uE1E7', '\uE1E7', '\uE1E7']))
  // Undo/redo work from toolbar focus, each chord resize is one atomic edit.
  await page.keyboard.press('Control+z')
  await ready(page)
  await expect(page.locator('.event-hit[data-duration="480"]')).toHaveCount(3)
  await page.keyboard.press('Control+y')
  await ready(page)
  await expect(page.locator('.event-hit[data-duration="720"]')).toHaveCount(3)
  await c.click()
  await page.getByRole('button', { name: 'Sharp accidental', exact: true }).click()
  await ready(page)
  const sharpC = page.getByRole('button', {
    name: 'C#4 note, Piano treble, measure 1, beat 1',
    exact: true,
  })
  await expect(sharpC).toBeVisible()
  const g = page.getByRole('button', {
    name: 'G4 note, Piano treble, measure 1, beat 1',
    exact: true,
  })
  await g.click({ modifiers: ['Shift'] })
  await expect(sharpC).toHaveAttribute('aria-pressed', 'true')
  await expect(g).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Delete')
  await ready(page)
  await expect(page.locator('.event-hit')).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await ready(page)
  await expect(page.locator('.event-hit')).toHaveCount(3)
  // Removing the active member of a multi-selection must return editing to its remaining member.
  await sharpC.click()
  await g.click({ modifiers: ['Shift'] })
  await g.click({ modifiers: ['Shift'] })
  await expect(sharpC).toHaveAttribute('aria-pressed', 'true')
  await expect(g).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('ArrowUp')
  await ready(page)
  await expect(
    page.getByRole('button', { name: 'D#4 note, Piano treble, measure 1, beat 1', exact: true }),
  ).toBeVisible()
  await expect(g).toBeVisible()
})

test('renders ties across system breaks and rejects destructive direct meter changes', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await ready(page)
  await selectMeasure(page, 'treble')
  await page.keyboard.press('1')
  await page.keyboard.press('c')
  await ready(page)
  await page.keyboard.press('3')
  await page.keyboard.press('c')
  await ready(page)
  const first = page.getByRole('button', {
    name: 'C4 note, Piano treble, measure 1, beat 1',
    exact: true,
  })
  await first.click()
  await page.getByRole('button', { name: 'Toggle tie', exact: true }).click()
  await ready(page)
  await expect(page.locator('.vf-notation-tie')).toHaveCount(1)
  await expect(page.locator('.vf-notation-tie path')).toHaveCount(1)
  await page.setViewportSize({ width: 800, height: 1000 })
  await page.locator('.score-viewport').evaluate((viewport) => {
    viewport.style.width = '260px'
  })
  await expect(page.locator('.vf-score-system')).toHaveCount(4)
  await ready(page)
  await expect(page.locator('.vf-notation-tie path')).toHaveCount(2)
  await page
    .getByRole('button', { name: 'Time signature, Piano treble, measure 1: 4/4', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Time signature editor' })
  await dialog.getByLabel('Time signature').selectOption('3/4')
  await dialog.getByRole('button', { name: 'Apply time signature', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('will not fit')
  await expect(first).toHaveAttribute('data-duration', '1920')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await ready(page)
})

test('measure-boundary signatures align parts, preserve notes, and keep entry boundaries correct', async ({
  page,
}) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await ready(page)
  await selectMeasure(page, 'treble', 3)
  await page.keyboard.press('e')
  await ready(page)
  const original = page.getByRole('button', {
    name: 'E4 note, Piano treble, measure 3, beat 1',
    exact: true,
  })
  const id = await original.getAttribute('data-event-id')
  await page
    .getByRole('button', { name: 'Time signature, Piano bass, measure 2: 4/4', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Time signature editor' })
  await dialog.getByLabel('Time signature').selectOption('3/4')
  await dialog.getByRole('button', { name: 'Apply time signature', exact: true }).click()
  await ready(page)
  await expect(original).toHaveAttribute('data-event-id', id!)
  await expect(original).toHaveAttribute('data-tick', '3360')
  await expect(page.getByRole('complementary').getByLabel('Time signature')).toHaveValue('3/4')
  await page
    .getByRole('button', { name: 'Key signature, Piano treble, measure 2: C major', exact: true })
    .click()
  const key = page.getByRole('dialog', { name: 'Key signature editor' })
  await key.getByLabel('Key signature').selectOption('Bb')
  await key.getByRole('button', { name: 'Apply key signature', exact: true }).click()
  await ready(page)
  await expect(
    page.getByRole('button', {
      name: 'Key signature, Piano bass, measure 3: B♭ major',
      exact: true,
    }),
  ).toBeVisible()
  await selectMeasure(page, 'bass', 2)
  await page.keyboard.press('2')
  await page.keyboard.press('c')
  await ready(page)
  await page.keyboard.press('d')
  await expect(page.getByRole('alert')).toContainText('crosses the barline')
  await page.keyboard.press('3')
  await page.keyboard.press('d')
  await ready(page)
  await expect(page.locator('.cursor-status')).toContainText('Measure 3, beat 1')
  await expect(page.locator('.vf-piano-brace')).toHaveCount(
    await page.locator('.vf-score-system').count(),
  )
})

test('dotted rests and adjacent chord seconds remain individually selectable', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await ready(page)
  await selectMeasure(page, 'bass')
  await page.keyboard.press('.')
  await page.keyboard.press('0')
  await ready(page)
  const rest = page.getByRole('button', {
    name: 'Rest, Piano bass, measure 1, beat 1',
    exact: true,
  })
  await expect(rest).toHaveAttribute('data-duration', '720')
  await rest.click()
  await page.keyboard.press('4')
  await ready(page)
  await expect(rest).toHaveAttribute('data-duration', '360')
  await page.keyboard.press('Delete')
  await ready(page)
  await page.keyboard.press('Control+z')
  await ready(page)
  await expect(rest).toHaveAttribute('data-duration', '360')
  await selectMeasure(page, 'treble')
  await page.keyboard.press('.') // remove dot
  await page.keyboard.press('h')
  for (const key of ['e', 'f']) {
    await page.keyboard.press(key)
    await ready(page)
  }
  const e = page.getByRole('button', {
    name: 'E4 note, Piano treble, measure 1, beat 1',
    exact: true,
  })
  const f = page.getByRole('button', {
    name: 'F4 note, Piano treble, measure 1, beat 1',
    exact: true,
  })
  await e.click()
  await expect(e).toHaveAttribute('aria-pressed', 'true')
  await f.click()
  await expect(f).toHaveAttribute('aria-pressed', 'true')
  await expect(e).toHaveAttribute('aria-pressed', 'false')
})

test('rest insertion and keyboard pitch movement stay silent', async ({ page }) => {
  await recordAudio(page)
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await ready(page)
  await selectMeasure(page, 'treble')
  await page.keyboard.press('0')
  await ready(page)
  await page
    .getByRole('button', { name: 'Rest, Piano treble, measure 1, beat 1', exact: true })
    .click()
  await page.keyboard.press('ArrowUp')
  await ready(page)
  expect(await midiNotes(page)).toEqual([])
  await expect(
    page.getByRole('button', { name: 'Rest, Piano treble, measure 1, beat 1', exact: true }),
  ).toHaveAttribute('data-duration', '480')
})

test('empty signature targets remain distinct at wrapped system starts', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await page.getByRole('button', { name: 'New score', exact: true }).click()
  await ready(page)
  await page.locator('.score-viewport').evaluate((viewport) => {
    viewport.style.width = '260px'
  })
  await expect(page.locator('.vf-score-system')).toHaveCount(4)
  await ready(page)
  for (const clef of ['treble', 'bass']) {
    const key = page.getByRole('button', {
      name: `Key signature, Piano ${clef}, measure 3: C major`,
      exact: true,
    })
    const time = page.getByRole('button', {
      name: `Time signature, Piano ${clef}, measure 3: 4/4`,
      exact: true,
    })
    await key.click({ timeout: 3000 })
    await expect(page.getByRole('dialog', { name: 'Key signature editor' })).toBeVisible()
    await page.keyboard.press('Escape')
    await time.click({ timeout: 3000 })
    await expect(page.getByRole('dialog', { name: 'Time signature editor' })).toBeVisible()
    await page.keyboard.press('Escape')
    const boxes = await page
      .locator(`.score-interaction g[data-clef="${clef}"][data-measure="2"] .signature-target`)
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().toJSON()),
      )
    expect(boxes[0]!.right).toBeLessThan(boxes[1]!.left)
  }
})
