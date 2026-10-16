import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseComposition } from '../../src/shared/composition'
import { ready, staffPoint, selectMeasure } from '../score-helpers'

test('desktop saves and reopens independently entered grand staff music and migrates old files', async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'notation-desktop-'))
  const scorePath = join(directory, 'first.notation')
  const app = await electron.launch({
    args: [...(process.env.TEST_ELECTRON_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), '.'],
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('heading', { name: 'A little beginning' })).toBeVisible()
    await ready(page)
    await page.screenshot({ path: testInfo.outputPath('desktop-workspace.png'), fullPage: true })
    expect(await page.evaluate(() => typeof window.notation?.openScore)).toBe('function')
    expect(
      await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require),
    ).toBe('undefined')
    expect(
      await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process),
    ).toBe('undefined')
    expect(await page.evaluate(() => Object.keys(window.notation!).sort())).toEqual([
      'openScore',
      'saveScore',
      'setDocumentDirty',
    ])
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, scorePath)
    await page.getByRole('button', { name: 'New score' }).click()
    await ready(page)
    await page.getByLabel('Title').fill('Grand staff round trip')
    await page.getByLabel('Title').press('Enter')
    await ready(page)
    const treble = await staffPoint(page, 'treble', 1, 0)
    await page.mouse.move(treble.x, treble.y)
    await expect(page.locator('.note-preview')).toHaveAttribute('data-preview-pitch', 'E4')
    await page.mouse.click(treble.x, treble.y)
    await ready(page)
    await expect(
      page.getByRole('button', { name: 'E4 note, Piano treble, measure 1, beat 1', exact: true }),
    ).toBeVisible()
    const bass = await staffPoint(page, 'bass', 1, 3)
    await page.mouse.move(bass.x, bass.y)
    await expect(page.locator('.note-preview')).toHaveAttribute('data-preview-pitch', 'C3')
    await page.mouse.click(bass.x, bass.y)
    await ready(page)
    await page.keyboard.press('e')
    await ready(page)
    await app.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBoxSync = () => 0
      BrowserWindow.getAllWindows()[0]!.close()
    })
    await expect(page.getByRole('heading', { name: 'Grand staff round trip' })).toBeVisible()
    await page.getByRole('button', { name: 'Save score' }).click()
    await expect(page.getByRole('status')).toHaveText('Saved first.notation.')
    const saved = parseComposition(JSON.parse(await readFile(scorePath, 'utf8')))
    expect(saved.schemaVersion).toBe(3)
    expect(saved.tracks[0]!.staves[0]!.events).toMatchObject([
      { startTick: 0, durationTicks: 480, pitch: { step: 'E', octave: 4 } },
    ])
    expect(saved.tracks[0]!.staves[1]!.events).toMatchObject([
      { startTick: 0, durationTicks: 480, pitch: { step: 'C', octave: 3 } },
      { startTick: 480, durationTicks: 480, pitch: { step: 'E', octave: 3 } },
    ])
    await page.getByRole('button', { name: 'New score' }).click()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await ready(page)
    await expect(page.getByRole('heading', { name: 'Grand staff round trip' })).toBeVisible()
    await expect(page.locator('.event-hit')).toHaveCount(3)
    await expect(
      page.getByRole('button', { name: 'E4 note, Piano treble, measure 1, beat 1', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'C3 note, Piano bass, measure 1, beat 1', exact: true }),
    ).toBeVisible()

    const legacy = {
      ...saved,
      schemaVersion: 1,
      title: 'Milestone 1 file',
      tracks: saved.tracks.map((part) => ({
        id: part.id,
        name: part.name,
        instrument: part.instrument,
        clef: part.staves[0]!.clef,
        events: part.staves[0]!.events,
      })),
    }
    await writeFile(scorePath, JSON.stringify(legacy))
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await ready(page)
    await expect(page.getByRole('heading', { name: 'Milestone 1 file' })).toBeVisible()
    await expect(page.locator('.event-hit')).toHaveCount(1)
    await expect(page.locator('.score-interaction g[data-clef="bass"]')).toHaveCount(4)
    await page.getByRole('button', { name: 'Save score' }).click()
    await expect(page.getByRole('status')).toHaveText('Saved first.notation.')
    expect(JSON.parse(await readFile(scorePath, 'utf8')).schemaVersion).toBe(3)
    await writeFile(scorePath, '{"schemaVersion":999}')
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Unsupported score version')
    await expect(page.getByRole('heading', { name: 'Milestone 1 file' })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    )
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

for (const zoomFactor of [1, 1.25]) {
  test(`desktop pitches match painted staff positions while scrolled at ${zoomFactor}x zoom`, async ({}, testInfo) => {
    const app = await electron.launch({
      args: [...(process.env.TEST_ELECTRON_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), '.'],
    })
    try {
      await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
      const page = await app.firstWindow()
      await ready(page)
      await app.evaluate(({ BrowserWindow }, zoom) => {
        const window = BrowserWindow.getAllWindows()[0]!
        window.setContentSize(1000, 750)
        window.webContents.setZoomFactor(zoom)
      }, zoomFactor)
      await ready(page)
      await page.getByRole('button', { name: 'New score', exact: true }).click()
      await ready(page)
      await testInfo.attach('viewport', {
        body: JSON.stringify(
          await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
            dpr: devicePixelRatio,
          })),
        ),
        contentType: 'application/json',
      })
      for (const { clef, measure, steps, pitch } of [
        { clef: 'treble', measure: 1, steps: 0, pitch: 'E4' },
        { clef: 'treble', measure: 2, steps: 1, pitch: 'F4' },
        { clef: 'treble', measure: 3, steps: -2, pitch: 'C4' },
        { clef: 'bass', measure: 1, steps: 3, pitch: 'C3' },
        { clef: 'bass', measure: 2, steps: 0, pitch: 'G2' },
        { clef: 'bass', measure: 3, steps: 8, pitch: 'A3' },
      ] as const) {
        await page.getByLabel('Title').focus()
        const point = await staffPoint(page, clef, measure, steps)
        await page.mouse.move(point.x, point.y)
        await expect(page.locator('.note-preview')).toHaveAttribute('data-preview-pitch', pitch)
        const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
        await page.mouse.click(point.x, point.y)
        await ready(page)
        await expect(
          page.getByRole('button', {
            name: `${pitch} note, Piano ${clef}, measure ${measure}, beat 1`,
            exact: true,
          }),
        ).toBeVisible()
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll)
      }
      const original = page.getByRole('button', {
        name: 'E4 note, Piano treble, measure 1, beat 1',
        exact: true,
      })
      await original.scrollIntoViewIfNeeded()
      const box = (await original.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      // One staff space (10 SVG units), transformed through actual native zoom.
      const space = await page
        .locator('.score-interaction')
        .evaluate((svg) => (svg as SVGSVGElement).getScreenCTM()!.d * 10)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - space)
      await page.mouse.up()
      await ready(page)
      await expect(
        page.getByRole('button', { name: 'G4 note, Piano treble, measure 1, beat 1', exact: true }),
      ).toBeVisible()
      await page.keyboard.press('Control+z')
      await ready(page)
      await expect(original).toBeVisible()
      await expect(page.locator('.vf-piano-brace')).toHaveCount(
        await page.locator('.vf-score-system').count(),
      )
      await expect(page.locator('.event-hit')).toHaveCount(6)
    } finally {
      await app.context().tracing.stop({ path: testInfo.outputPath('trace.zip') })
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
      )
      await app.close()
    }
  })
}

test('desktop restores edited chords, dotted rests, ties, and local signatures exactly', async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'notation-2b-'))
  const filePath = join(directory, 'edited.notation')
  const app = await electron.launch({
    args: [...(process.env.TEST_ELECTRON_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), '.'],
  })
  try {
    const page = await app.firstWindow()
    await ready(page)
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, filePath)
    await page.getByRole('button', { name: 'New score', exact: true }).click()
    await ready(page)
    await selectMeasure(page, 'treble')
    await page.keyboard.press('1')
    await page.keyboard.press('c')
    await ready(page)
    await page.keyboard.press('3')
    await page.keyboard.press('c')
    await ready(page)
    await page
      .getByRole('button', { name: 'C4 note, Piano treble, measure 1, beat 1', exact: true })
      .click()
    await page.getByRole('button', { name: 'Toggle tie', exact: true }).click()
    await ready(page)
    await selectMeasure(page, 'bass')
    await page.keyboard.press('3')
    await page.keyboard.press('h')
    await page.keyboard.press('.')
    for (const key of ['c', 'e', 'g']) {
      await page.keyboard.press(key)
      await ready(page)
    }
    await page.keyboard.press('h')
    await page.keyboard.press('ArrowRight')
    // Move after the chord instead of overwriting it.
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('0')
    await ready(page)
    await page
      .getByRole('button', { name: 'Key signature, Piano treble, measure 3: C major', exact: true })
      .click()
    const keyEditor = page.getByRole('dialog', { name: 'Key signature editor' })
    await keyEditor.getByLabel('Key signature').selectOption('Dm')
    await keyEditor.getByRole('button', { name: 'Apply key signature', exact: true }).click()
    await ready(page)
    await page
      .getByRole('button', { name: 'Time signature, Piano treble, measure 3: 4/4', exact: true })
      .click()
    const timeEditor = page.getByRole('dialog', { name: 'Time signature editor' })
    await timeEditor.getByLabel('Time signature').selectOption('6/8')
    await timeEditor.getByRole('button', { name: 'Apply time signature', exact: true }).click()
    await ready(page)
    await page.getByRole('button', { name: 'Save score', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Saved edited.notation.')
    const saved = parseComposition(JSON.parse(await readFile(filePath, 'utf8')))
    expect(saved.schemaVersion).toBe(3)
    expect(saved.signatureChanges).toEqual([
      { measure: 2, keySignature: 'Dm', timeSignature: { numerator: 6, denominator: 8 } },
    ])
    expect(saved.tracks[0]!.staves[0]!.events[0]).toMatchObject({
      durationTicks: 1920,
      tieTo: saved.tracks[0]!.staves[0]!.events[1]!.id,
    })
    expect(saved.tracks[0]!.staves[1]!.events).toMatchObject([
      { kind: 'note', startTick: 0, durationTicks: 720, pitch: { step: 'C', octave: 3 } },
      { kind: 'note', startTick: 0, durationTicks: 720, pitch: { step: 'E', octave: 3 } },
      { kind: 'note', startTick: 0, durationTicks: 720, pitch: { step: 'G', octave: 3 } },
      { kind: 'rest', startTick: 720, durationTicks: 720 },
    ])
    await page.getByRole('button', { name: 'New score', exact: true }).click()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await ready(page)
    await expect(page.locator('.event-hit')).toHaveCount(6)
    await expect(page.locator('.vf-notation-tie')).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: 'Rest, Piano bass, measure 1, beat 2.5', exact: true }),
    ).toHaveAttribute('data-duration', '720')
    await page.screenshot({ path: testInfo.outputPath('milestone-2b-desktop.png'), fullPage: true })
    await page.getByRole('button', { name: 'Save score', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Saved edited.notation.')
    expect(parseComposition(JSON.parse(await readFile(filePath, 'utf8')))).toEqual(saved)
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  } finally {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    )
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
