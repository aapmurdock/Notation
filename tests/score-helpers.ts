import { expect, type Page } from '@playwright/test'

export async function ready(page: Page): Promise<void> {
  await expect(page.locator('.engraving')).toHaveAttribute('data-render-state', 'ready')
  await expect(page.getByRole('alert')).toHaveCount(0)
}

/** Target the lines VexFlow actually painted, independently of the app's pitch mapping. */
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
      const staff = Array.from(document.querySelectorAll('.engraving .vf-stave')).find(
        (staff) =>
          staff.getAttribute('data-staff-id') === element.getAttribute('data-staff-id') &&
          staff.getAttribute('data-measure') === element.getAttribute('data-measure'),
      )!
      const lines = staff.querySelectorAll<SVGPathElement>('path')
      if (lines.length !== 5) throw new Error('Expected five engraved staff lines.')
      const bottom = lines[4]!.getPointAtLength(0).y
      const spacing = bottom - lines[3]!.getPointAtLength(0).y
      const point = new DOMPoint(
        start + (end - start) * fraction,
        bottom - (stepsAboveBottom * spacing) / 2,
      ).matrixTransform(lines[4]!.getScreenCTM()!)
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
