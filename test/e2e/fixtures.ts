// What every journey gets besides Playwright's own: `problems()`, the console
// errors, uncaught exceptions and failed requests to the app seen so far, and
// `host`, the stand-in host's log and controls (test/stack/host.ts).
import { test as base, expect, type Page } from '@playwright/test'
import { readState } from '../stack/state'

export interface HostCall {
  at: string
  method: string
  path: string
  query: string
  body: any
  status: number
}

const host = {
  async log(path?: string): Promise<HostCall[]> {
    const { hostUrl } = readState()
    return (await fetch(`${hostUrl}/__log${path ? `?path=${encodeURIComponent(path)}` : ''}`)).json()
  },
  async control(overrides: Record<string, unknown>) {
    const { hostUrl } = readState()
    await fetch(`${hostUrl}/__control`, { method: 'POST', body: JSON.stringify(overrides) })
  },
  async reset() {
    const { hostUrl } = readState()
    await fetch(`${hostUrl}/__reset`, { method: 'POST' })
  },
}

/** Starts collecting a page's problems (console errors, exceptions, failed requests to the app); call the result to read them. */
export function watch(page: Page) {
  const seen: string[] = []
  const { appUrl } = readState()
  page.on('console', (m) => {
    // Playwright's trace recorder injects a script into every frame; the sandboxed email
    // previews (srcdoc, no allow-scripts) refuse it, as they should anything.
    if (m.type() === 'error' && !/^Blocked script execution in 'about:srcdoc'/.test(m.text())) seen.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => seen.push(`exception: ${e.message}`))
  page.on('response', (r) => {
    if (r.url().startsWith(appUrl) && r.status() >= 500) seen.push(`${r.status()} ${r.request().method()} ${r.url().slice(appUrl.length)}`)
  })
  page.on('requestfailed', (r) => {
    // Leaving a page cancels what it was still loading; that's not a failure.
    const why = r.failure()?.errorText ?? ''
    if (r.url().startsWith(appUrl) && !/ERR_ABORTED|cancelled/i.test(why)) seen.push(`failed: ${r.method()} ${r.url().slice(appUrl.length)} (${why})`)
  })
  return () => [...seen]
}

export const test = base.extend<{ problems: () => string[]; host: typeof host }>({
  problems: async ({ page }, use) => {
    await use(watch(page))
  },
  host: async ({}, use) => {
    await use(host)
  },
})

export { expect }
