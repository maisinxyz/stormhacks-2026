import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('WCAG AA: Desk, dark theme, settings and notifications', async ({ page }) => {
  test.setTimeout(60000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('[data-platform-moving="false"]')).toHaveCount(3)
  const check = async (name: string) => {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    await test.info().attach(name, { body: JSON.stringify(result.violations, null, 2), contentType: 'application/json' })
    expect.soft(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), name).toEqual([])
  }
  await check('light desk')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await check('light settings')
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await check('dark settings')
  await page.keyboard.press('Escape')
  await check('dark desk')
  await page.getByRole('button', { name: 'Notifications', exact: true }).first().click()
  await check('dark notifications')
})
