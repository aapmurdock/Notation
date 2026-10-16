import { expect, test } from '@playwright/test'
import { ready, staffPoint } from '../score-helpers'

for (const { height, scale } of [
  { height: 750, scale: 1 },
  { height: 500, scale: 1.25 },
]) {
  test.describe(`scrolled entry at ${height}px height and ${scale}x scale`, () => {
    test.use({ viewport: { width: 1280, height }, deviceScaleFactor: scale })

    for (const { clef, steps, pitch } of [
      { clef: 'treble', steps: 0, pitch: 'E4' },
      { clef: 'bass', steps: 3, pitch: 'C3' },
    ] as const) {
      test(`clicking the engraved ${clef} position inserts ${pitch} without scrolling`, async ({
        page,
      }) => {
        await page.goto('/')
        await ready(page)
        await page.getByRole('button', { name: 'New score', exact: true }).click()
        await ready(page)
        if (scale !== 1) {
          await page.evaluate((scale) => {
            document.body.style.zoom = String(scale)
          }, scale)
        }
        // Leave focus outside the score. Focusing its large SVG used to scroll
        // during pointerdown and invalidate the event's client coordinates.
        await page.getByLabel('Title').fill('Scrolled pitch regression')
        await page.getByLabel('Title').press('Enter')
        await ready(page)
        const point = await staffPoint(page, clef, 1, steps)
        await page.mouse.move(point.x, point.y)
        await expect(page.locator('.note-preview')).toHaveAttribute('data-preview-pitch', pitch)
        const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
        await page.mouse.click(point.x, point.y)
        await ready(page)
        await expect(
          page.getByRole('button', {
            name: `${pitch} note, Piano ${clef}, measure 1, beat 1`,
            exact: true,
          }),
        ).toBeVisible()
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scroll)
        await expect(
          page.getByRole('group', { name: 'Interactive score', exact: true }),
        ).toBeFocused()
      })
    }
  })
}
