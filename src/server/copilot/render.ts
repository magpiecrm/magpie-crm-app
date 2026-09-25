import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Renders compiled email HTML to a PNG so the copilot can look at its own work.
 *
 * Uses `playwright-core` against a Chromium already on the machine rather than
 * pulling a ~150MB browser download as a dependency. If none is found, the
 * caller degrades to the text-only lint rather than failing the turn.
 */

/** Common locations for a Chromium that Playwright can drive. */
function findChromium(): string | null {
  const explicit = process.env.COPILOT_CHROMIUM_PATH
  if (explicit && existsSync(explicit)) return explicit

  const playwrightRoot = join(homedir(), '.cache', 'ms-playwright')
  const candidates: string[] = []
  if (existsSync(playwrightRoot)) {
    // Newest build first, so we do not pin a stale one.
    for (const dir of readdirSync(playwrightRoot).sort().reverse()) {
      if (dir.startsWith('chromium_headless_shell-')) {
        candidates.push(join(playwrightRoot, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'))
      } else if (dir.startsWith('chromium-')) {
        candidates.push(join(playwrightRoot, dir, 'chrome-linux64', 'chrome'))
        candidates.push(join(playwrightRoot, dir, 'chrome-linux', 'chrome'))
      }
    }
  }
  candidates.push(
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  )

  return candidates.find(existsSync) ?? null
}

let cachedPath: string | null | undefined

export function chromiumPath(): string | null {
  if (cachedPath === undefined) cachedPath = findChromium()
  return cachedPath
}

/**
 * A Chromium binary can be present but unlaunchable — Playwright ships the
 * browser without its system libraries, so a machine that has never run
 * `playwright install-deps` fails with a missing `libatk-1.0.so.0`. Remember
 * that so we do not pay a doomed browser launch on every call.
 */
let launchFailure: string | null = null

export function renderUnavailableReason(): string | null {
  if (!chromiumPath()) return 'no Chromium binary was found on this server'
  return launchFailure
}

/** The one-line fix, surfaced to the model and through it to the user. */
export const RENDER_SETUP_HINT =
  'Image previews need Chromium and its system libraries: run `sudo npx playwright install-deps chromium` on the server (or set COPILOT_CHROMIUM_PATH to a working Chrome).'

export interface RenderResult {
  /** Base64 PNG. */
  data: string
  width: number
  height: number
}

/**
 * Screenshot the email at a given viewport width.
 *
 * 600px is the standard email content width; 375px approximates a phone, which
 * is where most marketing email is actually read.
 */
export async function renderEmailPng(html: string, width = 700): Promise<RenderResult> {
  const executablePath = chromiumPath()
  if (!executablePath) {
    throw new Error(`No Chromium found on this server. ${RENDER_SETUP_HINT}`)
  }

  if (launchFailure) throw new Error(`${launchFailure} ${RENDER_SETUP_HINT}`)

  const { chromium } = await import('playwright-core')
  let browser
  try {
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
  } catch (err: any) {
    // Playwright's error is a page of browser logs; reduce it to the one line
    // that identifies the cause, and remember the failure.
    const missingLib = String(err?.message ?? '').match(/error while loading shared libraries: ([^:]+)/)
    launchFailure = missingLib
      ? `Chromium is installed but cannot start — missing system library ${missingLib[1]}.`
      : 'Chromium is installed but failed to start.'
    throw new Error(`${launchFailure} ${RENDER_SETUP_HINT}`)
  }
  try {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
    })
    await page.setContent(html, { waitUntil: 'load', timeout: 15_000 })
    // Remote images are the norm in these designs; give them a moment, but do
    // not fail the render if one is slow or dead.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    const buffer = await page.screenshot({ fullPage: true, type: 'png' })
    const dimensions = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      h: document.documentElement.scrollHeight,
    }))
    return { data: buffer.toString('base64'), width: dimensions.w, height: dimensions.h }
  } finally {
    await browser.close().catch(() => {})
  }
}
