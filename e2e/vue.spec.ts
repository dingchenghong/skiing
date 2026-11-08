import { expect, test } from '@playwright/test'

test('shows the ski game landing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '雪道冲刺' })).toBeVisible()
  await expect(page.getByRole('button', { name: /开始下滑|正在准备雪道/ })).toBeVisible()
})
