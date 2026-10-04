import { test, expect } from '@playwright/test'

test('responsive visual captures and scroll frame timing', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto('/')
  await expect(page.locator('[data-platform-moving="false"]')).toHaveCount(3)
  const metrics = await page.evaluate(async () => {
    const samples: number[] = []; let last = performance.now(), start = last
    await new Promise<void>(resolve => {
      const frame = (now: number) => {
        samples.push(now-last); last=now
        window.scrollTo(0, (1-Math.cos((now-start)/700)) * 310)
        if (now-start < 3500) requestAnimationFrame(frame); else resolve()
      }; requestAnimationFrame(frame)
    })
    samples.sort((a,b)=>a-b)
    return { frames: samples.length, medianMs: samples[Math.floor(samples.length*.5)], p95Ms: samples[Math.floor(samples.length*.95)], over33ms: samples.filter(n=>n>33.4).length, userAgent: navigator.userAgent }
  })
  console.log('SCROLL_FRAME_METRICS', JSON.stringify(metrics))
  await test.info().attach('scroll-timing', { body: JSON.stringify(metrics,null,2), contentType: 'application/json' })
  for (const [name,width,height] of [['desktop',1440,1000],['laptop',1280,800],['tablet',768,1024],['mobile',390,844]] as const) {
    await page.setViewportSize({width,height})
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.locator('.end-note').scrollIntoViewIfNeeded()
    await expect(page.locator('.end-note')).toBeVisible()
    await page.waitForTimeout(450)
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0,0) })
    await page.waitForTimeout(450)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),name).toBe(true)
    await page.screenshot({path:`test-results/${name}-full.png`,fullPage:true})
  }
})

test('a treat dragged after scrolling lands on Pip', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Give Pip treat 1' }).scrollIntoViewIfNeeded()
  const treat = (await page.getByRole('button', { name: 'Give Pip treat 1' }).boundingBox())!
  const pet = (await page.locator('[data-pet-drop]').boundingBox())!
  await page.mouse.move(treat.x+treat.width/2,treat.y+treat.height/2)
  await page.mouse.down()
  await page.mouse.move(pet.x+pet.width/2,pet.y+pet.height/2,{steps:20})
  await page.mouse.up()
  await expect(page.locator('.toast')).toHaveText(/Pip got a treat/)
})
