import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/desktop',
  outputDir: './test-results/desktop',
  workers: 1,
  timeout: 30_000,
})
