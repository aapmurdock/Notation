import { expect, type Page } from '@playwright/test'

export async function ready(page: Page): Promise<void> {
  await expect(page.locator('.engraving')).toHaveAttribute('data-render-state', 'ready')
  await expect(page.getByRole('alert')).toHaveCount(0)
}

/** Point into an initially empty bar using its actual SVG coordinate transform. */
export async function staffPoint(
  page: Page,
  clef: 'treble' | 'bass',
  measure = 1,
  stepsAboveBottom = 0,
  fraction = 0,
  part = 'Piano',
) {
  const header = page.getByRole('button', {
    name: `Select ${part} ${clef} measure ${measure}`,
    exact: true,
  })
  const group = header.locator('..')
  await group.scrollIntoViewIfNeeded()
  return group.evaluate(
    (element, { stepsAboveBottom, fraction }) => {
      const start = Number(element.getAttribute('data-note-start'))
      const end = Number(element.getAttribute('data-note-end'))
      const bottom = Number(element.getAttribute('data-bottom'))
      const point = new DOMPoint(
        start + (end - start) * fraction,
        bottom - stepsAboveBottom * 5,
      ).matrixTransform(element.closest('svg')!.getScreenCTM()!)
      return { x: point.x, y: point.y }
    },
    { stepsAboveBottom, fraction },
  )
}

export async function selectMeasure(
  page: Page,
  clef: 'treble' | 'bass',
  measure = 1,
  part = 'Piano',
) {
  await page
    .getByRole('button', { name: `Select ${part} ${clef} measure ${measure}`, exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Measure entry options' })).toBeVisible()
  await page.getByRole('button', { name: 'Close entry options' }).click()
}
