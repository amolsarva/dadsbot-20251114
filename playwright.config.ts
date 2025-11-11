import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  webServer: { command: 'npm run dev', port: 3000, timeout: 120000, reuseExistingServer: !process.env.CI },
  use: { headless: true },
})
