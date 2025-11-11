import { test, expect } from '@playwright/test'

const baseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000'

test('diagnostics page renders and shows the run button', async ({ page }) => {
  await page.goto(`${baseUrl}/diagnostics`)
  await expect(page.getByRole('heading', { name: /Diagnostics/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Run full diagnostics/i })).toBeVisible()
})
