// Journeys through the real app, in a real browser, against the test stack
// (test/stack): the production build with every outside service stood in for.
//
//   bun run e2e                    starts a stack if none is running, runs every journey
//   bun run e2e -- sequences       just the files matching "sequences"
//   bun run e2e -- --project=phone the journeys tagged @phone, at phone size
//
// Uses this machine's Chrome (GitHub's runners have it too), so no browser download.
import { defineConfig, devices } from '@playwright/test'
import { join } from 'path'
import { basePort, stackDir } from '../stack/state'

const port = basePort()
const out = stackDir(port)

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts/,
  // Journeys share one workspace and one scheduler, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 3 * 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  forbidOnly: !!process.env.CI,
  outputDir: join(out, 'e2e-results'),
  reporter: [['list'], ['html', { outputFolder: join(out, 'e2e-report'), open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    trace: 'retain-on-failure',
    // A trace has every step's screenshot and DOM; video would need Playwright's own ffmpeg download.
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun test/stack/up.ts',
    cwd: join(import.meta.dirname, '../..'),
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: true,
    // A first run builds the app.
    timeout: 6 * 60_000,
    stdout: 'pipe',
    // Ask it to stop, so it removes its mail containers (a kill, Playwright's default, leaves them).
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: 'chrome', storageState: join(out, 'auth.json') },
      dependencies: ['setup'],
    },
    {
      name: 'phone',
      grep: /@phone/,
      use: { ...devices['Pixel 7'], channel: 'chrome', storageState: join(out, 'auth.json') },
      dependencies: ['setup'],
    },
  ],
})
