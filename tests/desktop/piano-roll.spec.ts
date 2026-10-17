import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createComposition, parseComposition } from '../../src/shared/composition'
import { changeSignature, toggleTies } from '../../src/shared/editing'
import { insertPianoNote, pianoNotes } from '../../src/shared/piano-roll'
import { ready } from '../score-helpers'
import { block, dragBlock, rollPoint, rollReady } from '../piano-roll-helpers'

for (const zoom of [1, 1.25]) {
  test(`desktop piano-roll editing and exact file round trip at ${zoom}x native zoom`, async ({}, testInfo) => {
    const directory = await mkdtemp(join(tmpdir(), 'notation-3a-'))
    const filePath = join(directory, 'piano-roll.notation')
    let original = changeSignature(createComposition(), 1, {
      keySignature: 'G',
      timeSignature: { numerator: 6, denominator: 8 },
    })
    const part = original.tracks[0]!.id
    const first = insertPianoNote(original, part, 0, 60, 480)
    const third = insertPianoNote(first.score, part, 0, 64, 480)
    const tied = insertPianoNote(third.score, part, 480, 60, 480)
    original = toggleTies(tied.score, [first.id])
    original = insertPianoNote(original, part, 0, 48, 960).score
    await writeFile(filePath, JSON.stringify({ ...original, schemaVersion: 3 }))
    const app = await electron.launch({
      args: [...(process.env.TEST_ELECTRON_NO_SANDBOX === '1' ? ['--no-sandbox'] : []), '.'],
    })
    try {
      const page = await app.firstWindow()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await ready(page)
      await app.evaluate(
        ({ BrowserWindow, dialog }, { filePath, zoom }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          window.setContentSize(1100, 900)
          window.webContents.setZoomFactor(zoom)
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
          dialog.showSaveDialog = async () => ({ canceled: false, filePath })
        },
        { filePath, zoom },
      )
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await ready(page)
      await page.getByRole('tab', { name: 'Piano roll', exact: true }).click()
      await rollReady(page)
      await expect(page.locator('.roll-note')).toHaveCount(4)
      await page.getByRole('combobox', { name: 'Piano roll snap' }).selectOption('60')
      await block(page, 0, 60).locator('.roll-note-body').click()
      await page.getByRole('button', { name: 'Select chord / ties', exact: true }).click()
      await expect(page.locator('.roll-note.selected')).toHaveCount(3)
      await dragBlock(page, block(page, 0, 60), 60, 0)
      await expect(block(page, 60, 60)).toHaveAttribute('data-event-id', first.id)
      await expect(block(page, 60, 64)).toHaveAttribute('data-event-id', third.id)
      await expect(block(page, 540, 60)).toHaveAttribute('data-event-id', tied.id)
      await page.locator('.roll-grid').focus()
      await page.keyboard.press('Escape')
      const sustain = await rollPoint(page, 1860, 65)
      await page.mouse.click(sustain.x, sustain.y)
      const sustained = block(page, 1860, 65)
      const sustainedId = await sustained.getAttribute('data-event-id')
      await expect(sustained).toHaveAttribute('data-duration', '480')
      await dragBlock(page, sustained, 120, 0, true)
      await expect(sustained).toHaveAttribute('data-duration', '600')
      await page.locator('.roll-grid').focus()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Thirty-second duration', exact: true }).click()
      const small = await rollPoint(page, 1200, 49)
      await page.mouse.click(small.x, small.y)
      const smallBlock = block(page, 1200, 49)
      const smallId = await smallBlock.getAttribute('data-event-id')
      await expect(smallBlock).toHaveAttribute('data-duration', '60')
      await dragBlock(page, smallBlock, 60, 2)
      await expect(block(page, 1260, 51)).toHaveAttribute('data-event-id', smallId!)
      await page.getByRole('button', { name: 'Save score', exact: true }).click()
      await expect(page.getByRole('status')).toHaveText('Saved piano-roll.notation.')
      const saved = parseComposition(JSON.parse(await readFile(filePath, 'utf8')))
      expect(saved.schemaVersion).toBe(4)
      const savedNotes = pianoNotes(saved, part)
      expect(savedNotes.find((note) => note.event.id === first.id)!.event.tieTo).toBe(tied.id)
      expect(savedNotes.find((note) => note.event.id === sustainedId)).toMatchObject({
        midi: 65,
        clef: 'treble',
        event: { startTick: 1860, durationTicks: 600 },
      })
      expect(savedNotes.find((note) => note.event.id === smallId)).toMatchObject({
        midi: 51,
        clef: 'bass',
        event: { startTick: 1260, durationTicks: 60, velocity: 80 },
      })
      expect(saved.signatureChanges).toEqual(original.signatureChanges)
      await page.getByRole('button', { name: 'New score', exact: true }).click()
      await expect(page.locator('.roll-note')).toHaveCount(0)
      await page.getByRole('button', { name: 'Open', exact: true }).click()
      await rollReady(page)
      await expect(page.locator('.roll-note')).toHaveCount(6)
      await expect(block(page, 1260, 51)).toHaveAttribute('data-duration', '60')
      await page.getByRole('tab', { name: 'Notation', exact: true }).click()
      await ready(page)
      await expect(page.locator(`.event-hit[data-event-id="${sustainedId}"]`)).toHaveCount(3)
      await expect(page.locator('.vf-notation-tie')).toHaveCount(3)
      await expect(page.locator(`.event-hit[data-event-id="${smallId}"]`)).toHaveAttribute(
        'data-duration',
        '60',
      )
      await page.getByRole('button', { name: 'Save score', exact: true }).click()
      await expect(page.getByRole('status')).toHaveText('Saved piano-roll.notation.')
      expect(parseComposition(JSON.parse(await readFile(filePath, 'utf8')))).toEqual(saved)
      expect(errors).toEqual([])
      await page.screenshot({
        path: testInfo.outputPath('milestone-3a-desktop.png'),
        fullPage: true,
      })
    } finally {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
      )
      await app.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
}
