// Every page, in light and dark (and at phone width in the phone project):
// it opens signed in, with no console error, no uncaught exception, no failed
// request to the app and, at phone width, no sideways scroll. A screenshot of
// each is kept in the stack's folder (pages/) for a person or agent to look over.
import { expect, test } from './fixtures'
import { join } from 'path'
import { stackDir } from '../stack/state'

const PAGES = [
  '/collection',
  '/collection/personas',
  '/collection/prospect-search',
  '/marketing/analytics',
  '/marketing/campaigns',
  '/marketing/companies',
  '/marketing/contacts',
  '/marketing/contacts/import',
  '/marketing/forms',
  '/marketing/lists',
  '/marketing/lists/new',
  '/marketing/surveys',
  '/marketing/templates',
  '/sales/deals',
  '/sales/inbox',
  '/sales/pipeline',
  '/sales/sequences',
  '/sales/tasks',
]
const SETTINGS = ['overview', 'search', 'sending', 'senders', 'warmup', 'pipelines', 'copilot', 'mcp', 'billing', 'team', 'fields', 'api']

const all = [...PAGES, ...SETTINGS.map((s) => `/settings?tab=${s}`)]

/**
 * App bugs found and not fixed yet: the problem each page is allowed until then, and on
 * which project. Each is recorded on the test (annotation) so it shows in the report.
 * Remove an entry with its fix.
 */
const KNOWN: Array<{ project?: string; scheme?: 'light' | 'dark'; paths: string[] | 'all'; problem: RegExp; issue: string }> = [
  {
    project: 'phone',
    paths: ['/collection', '/collection/prospect-search'],
    problem: /Minified React error #418/,
    issue: 'At phone width, Prospect Search sometimes renders different text in the browser than the server sent (React hydration mismatch #418). Found 2026-11-17, cause not found yet.',
  },
]

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} @phone`, () => {
    for (const path of all) {
      test(path, async ({ page, problems }, info) => {
        // A theme picked with the toggle wins over the system's: so pick it, then check it shows.
        await page.addInitScript((s) => localStorage.setItem('theme', s), scheme)
        await page.emulateMedia({ colorScheme: scheme })
        await page.goto(path)
        await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${scheme}\\b`))
        await page.waitForLoadState('networkidle')
        await expect(page).not.toHaveURL(/\/login/)
        await expect(page.locator('body')).not.toHaveText(/Something went wrong|Application error/i)

        if (info.project.name === 'phone') {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
          expect(overflow, 'the page scrolls sideways at phone width').toBeLessThanOrEqual(1)
        }
        const known = KNOWN.filter((k) => (!k.project || k.project === info.project.name) && (!k.scheme || k.scheme === scheme) && (k.paths === 'all' || k.paths.includes(path)))
        const unexplained = problems().filter((p) => !known.some((k) => k.problem.test(p)))
        if (unexplained.length < problems().length) for (const k of known) info.annotations.push({ type: 'known issue', description: k.issue })
        expect(unexplained).toEqual([])
        const name = `${info.project.name}-${scheme}-${path.replace(/^\//, '').replace(/[/?=]+/g, '_')}.png`
        await page.screenshot({ path: join(stackDir(), 'pages', name), fullPage: true })
      })
    }
  })
}
