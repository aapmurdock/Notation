import { defineConfig } from '@playwright/test'

export default defineConfig({
  // Keep failed assertions visible in Actions checks as well as downloadable logs.
  reporter: process.env.GITHUB_ACTIONS
    ? [['list'], ['github'], ['./tests/ci-diagnostics-reporter.ts']]
    : 'list',
  testDir: './tests/desktop',
  outputDir: './test-results/desktop',
  workers: 1,
  timeout: 30_000,
})
