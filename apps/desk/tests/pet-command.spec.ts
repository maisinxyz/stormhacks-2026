import { test, expect } from '@playwright/test'

test('empty desk accepts text commands, animates a response, and speaks it', async ({ page }) => {
  await page.route('**/session', route => route.fulfill({ status: 503, body: '{}' }))
  await page.route('**/pets', route => route.fulfill({ status: 503, body: '{}' }))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speaking: false, cancel() {}, resume() {},
      speak(utterance: SpeechSynthesisUtterance) {
        (window as any).__spoken = { text: utterance.text, volume: utterance.volume }
        utterance.onstart?.(new Event('start') as SpeechSynthesisEvent)
        utterance.onend?.(new Event('end') as SpeechSynthesisEvent)
      },
    } })
  })
  await page.goto('/')
  const input = page.getByRole('textbox', { name: 'Message your friend' })
  await expect(input).toBeEnabled()
  await input.fill('sit down')
  await input.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Okay, I will sit!' })).toBeVisible()
  await expect(page.locator('.pet-nameplate--empty')).toContainText('sit')
  await expect.poll(() => page.evaluate(() => (window as any).__spoken?.text)).toBe('Okay, I will sit!')
  await expect.poll(() => page.evaluate(() => (window as any).__spoken?.volume)).toBe(0.75)
  const status = await page.locator('.pet-nameplate--empty').boundingBox()
  const caption = await page.locator('.habitat-caption').boundingBox()
  expect(status && caption && caption.y).toBeGreaterThan((status?.y ?? 0) + (status?.height ?? 0))
})
