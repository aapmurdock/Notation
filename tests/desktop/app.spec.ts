import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseComposition } from '../../src/shared/composition'
import { ready, staffPoint } from '../score-helpers'

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
    await page.mouse.click(treble.x, treble.y)
    await ready(page)
    const bass = await staffPoint(page, 'bass', 1, 3)
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
    expect(saved.schemaVersion).toBe(2)
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
    expect(JSON.parse(await readFile(scorePath, 'utf8')).schemaVersion).toBe(2)
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
