// Where a running test stack says what it is: its addresses, its throwaway
// login and its mail server's ports. `up.ts` writes it (mode 600) into the
// stack's own temporary folder; tests and agents read it from there.

import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface StackState {
  /** The app, as a browser opens it. */
  appUrl: string
  /** The stand-in for every outside service (host.ts). */
  hostUrl: string
  login: { email: string; password: string }
  mail: {
    /** Mailpit: every email the app sends. */
    smtpPort: number
    /** Mailpit's web view and API (/api/v1/…). */
    webUrl: string
    /** GreenMail: the senders' inboxes, over IMAP… */
    imapPort: number
    /** …and over SMTP, to deliver a reply into one. */
    inboxSmtpPort: number
    inboxApiPort: number
  }
  /** Hosted (as a customer's copy runs) or self-hosted (own keys). */
  mode: 'hosted' | 'self-hosted'
  dir: string
  dbPath: string
  startedAt: string
}

/** The app's port; each stack's other ports and folder follow from it, so two can run side by side. */
export const basePort = () => Number(process.env.TEST_STACK_PORT) || 4700

export const stackDir = (port = basePort()) => join(tmpdir(), `magpie-test-stack-${port}`)

export function readState(port = basePort()): StackState {
  const file = join(stackDir(port), 'state.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`No test stack on port ${port} (${file} missing). Start one: bun test/stack/up.ts`)
  }
}
