import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseComposition } from '../../src/shared/composition'

test('desktop bridge saves and reopens a real score with an isolated renderer', async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), 'notation-desktop-'))
  const scorePath = join(directory, 'first.notation')
  const app = await electron.launch({
    args: [
      ...(process.env.TEST_ELECTRON_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      '.',
    ],
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('heading', { name: 'A little beginning' })).toBeVisible()
    await expect(page.locator('[data-render-state="ready"]')).toHaveCount(4)
    await page.screenshot({ path: testInfo.outputPath('desktop-workspace.png'), fullPage: true })
    expect(await page.evaluate(() => typeof window.notation?.openScore)).toBe('function')
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined')
    expect(await page.evaluate(() => typeof (window as unknown as { process?: unknown }).process)).toBe('undefined')
    expect(await page.evaluate(() => Object.keys(window.notation!).sort())).toEqual(['openScore', 'saveScore', 'setDocumentDirty'])
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, scorePath)
    await page.getByLabel('Title').fill('Desktop round trip')
    await page.getByLabel('Title').press('Enter')
    // Cancel the native close confirmation and verify edits remain available.
    await app.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showMessageBoxSync = () => 0
      BrowserWindow.getAllWindows()[0]!.close()
    })
    await expect(page.getByRole('heading', { name: 'Desktop round trip' })).toBeVisible()
    await page.getByRole('button', { name: 'Save score' }).click()
    await expect(page.getByRole('status')).toHaveText('Saved first.notation.')
    const saved = parseComposition(JSON.parse(await readFile(scorePath, 'utf8')))
    expect(saved.title).toBe('Desktop round trip')
    expect(saved.tracks[0]!.events).toHaveLength(13)
    await page.getByRole('button', { name: 'New score' }).click()
    await expect(page.getByRole('heading', { name: 'Untitled composition' })).toBeVisible()
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Desktop round trip' })).toBeVisible()
    await expect(page.locator('[data-render-state="ready"]')).toHaveCount(4)
    await writeFile(scorePath, '{"schemaVersion":999}')
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Unsupported score version')
    await expect(page.getByRole('heading', { name: 'Desktop round trip' })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()))
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
