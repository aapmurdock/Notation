import { expect, test } from '@playwright/test'

test('engraves offline and edits a score across parts and bars', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Fonts and score rendering must work without any external service.
  await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'A little beginning' })).toBeVisible()
  await expect(page.locator('[data-render-state="ready"]')).toHaveCount(4)
  await expect(page.getByRole('img', { name: 'Piano, measure 1', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.fonts.check('16px Bravura'))).toBe(true)
  for (const width of [900, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.locator('.engraving svg').evaluateAll((svgs) => svgs.every((svg) => {
      const bounds = svg.getBoundingClientRect()
      const measure = svg.closest('.measure')!.getBoundingClientRect()
      return bounds.left >= measure.left && bounds.right <= measure.right + 1
    }))).toBe(true)
  }
  await page.screenshot({ path: testInfo.outputPath('initial-score.png'), fullPage: true })
  await page.getByRole('button', { name: 'New score' }).click()
  await page.getByLabel('Title').fill('My first composition')
  await page.getByLabel('Title').press('Enter')
  await expect(page.getByRole('heading', { name: 'My first composition' })).toBeVisible()
  await page.getByRole('combobox', { name: 'Pitch', exact: true }).selectOption('F')
  await page.getByRole('combobox', { name: 'Accidental', exact: true }).selectOption('#')
  await page.getByRole('combobox', { name: 'Duration', exact: true }).selectOption('240')
  await page.getByRole('button', { name: '+ Add note' }).click()
  await page.getByRole('button', { name: '+ Add note' }).click()
  await expect(page.locator('[data-render-state="ready"]')).toHaveCount(4)
  await expect(page.locator('.vf-stavenote')).toHaveCount(7)
  await page.getByRole('button', { name: 'Select Piano measure 2', exact: true }).click()
  await page.getByLabel('Duration').selectOption('1920')
  await page.getByRole('button', { name: '+ Add note' }).click()
  await page.getByRole('button', { name: 'Add rest' }).click()
  await expect(page.getByRole('alert')).toContainText('measure is full')
  await page.getByRole('button', { name: 'Remove last entry' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByLabel('New part instrument').selectOption({ label: 'Cello' })
  await page.getByRole('button', { name: '+ Add part' }).click()
  await expect(page.locator('[data-render-state="ready"]')).toHaveCount(8)
  await expect(page.getByRole('img', { name: 'Cello, measure 1', exact: true })).toBeVisible()
  await page.getByLabel('Octave').selectOption('3')
  await page.getByRole('button', { name: '+ Add note' }).click()
  await page.getByRole('button', { name: '+ Add measure' }).click()
  await expect(page.locator('[data-render-state="ready"]')).toHaveCount(10)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true })
})
