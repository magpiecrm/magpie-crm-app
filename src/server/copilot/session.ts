import { spawn, type ChildProcess } from 'child_process'
import { copilotConfigDir, requireAnthropicKey } from './settings'
import { db } from '../db'
import { getProvider } from './providers'
import type { CopilotEvent, CopilotProvider } from './providers'
import { buildSystemPrompt } from './prompt'
import { drainClientActions, emitEvent, getSession } from './state'
import type { PermissionMode } from './permissions'

interface RunningSession {
  child: ChildProcess
  provider: CopilotProvider
  /** Partial stdout line carried between chunks. */
  buffer: string
  /** True between sending a turn and receiving its `result`. */
  busy: boolean
  stderr: string
  /** This process was started with `--resume`. */
  resumed: boolean
  /** Whether the CLI produced any parseable output before exiting. */
  sawOutput: boolean
}

const GLOBAL_KEY = Symbol.for('email-marketing:copilot-processes')
const g = globalThis as any
if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map<string, RunningSession>()
const running: Map<string, RunningSession> = g[GLOBAL_KEY]

export interface TurnOptions {
  sessionId: string
  providerId: string
  message: string
  model?: string
  effort?: string
  permissionMode: PermissionMode
  /** Absolute URL the CLI should reach our MCP endpoint on. */
  mcpUrl: string
}

/**
 * Environment for the spawned CLI.
 *
 * Whitelisted rather than inherited so the app's own secrets — SocialFetch, Reacher,
 * SMTP, AUTH_PASSWORD — are never visible to the agent process. It reaches the
 * platform only through MCP, which is auth'd separately per session.
 *
 * The CLI authenticates with the user's own Anthropic API key and runs from
 * the app's own config directory, so it can never fall back to a Claude.ai
 * login on this machine (see copilot/settings.ts for why).
 */
function safeEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TERM', 'TMPDIR', 'XDG_RUNTIME_DIR']
  const env: NodeJS.ProcessEnv = {}
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key]
  }
  env.ANTHROPIC_API_KEY = requireAnthropicKey()
  env.CLAUDE_CONFIG_DIR = copilotConfigDir()
  return env
}

function start(opts: TurnOptions, resume: boolean): RunningSession {
  const session = getSession(opts.sessionId)
  if (!session) throw new Error('Copilot session not found. Reload the page and try again.')

  const provider = getProvider(opts.providerId)
  // Read the brand kit here rather than in a tool, so it is in the system
  // prompt from the first token instead of costing a round trip.
  let brand: Record<string, any> | null = null
  try {
    brand = db.getBrandKit()
  } catch {
    // Brand kit is optional; never block a turn on it.
  }
  const args = provider.buildArgs({
    sessionId: opts.sessionId,
    systemPrompt: buildSystemPrompt(session.clientState, brand),
    mcpUrl: opts.mcpUrl,
    mcpToken: session.token,
    model: opts.model,
    effort: opts.effort,
    resume,
  })

  const child = spawn(provider.command, args, {
    env: safeEnv(),
    // The agent has no filesystem tools, but run it somewhere harmless anyway
    // rather than in the app's working directory.
    cwd: process.env.TMPDIR || '/tmp',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const entry: RunningSession = {
    child,
    provider,
    buffer: '',
    busy: false,
    stderr: '',
    resumed: resume,
    sawOutput: false,
  }

  // Published to the session-wide bus in `state.ts` rather than a local set, so
  // provider output and approval prompts raised inside tool handlers arrive on
  // the same stream in the right order.
  const emit = (event: CopilotEvent) => emitEvent(opts.sessionId, event)

  child.stdout.on('data', chunk => {
    entry.buffer += chunk.toString()
    const lines = entry.buffer.split('\n')
    entry.buffer = lines.pop() ?? ''
    for (const line of lines) {
      for (const event of provider.parseLine(line)) {
        entry.sawOutput = true
        if (event.type === 'done' || event.type === 'error') entry.busy = false
        emit(event)
        // Nothing more will come of this process; stop it rather than let it
        // keep retrying in the background.
        if (event.type === 'error' && event.fatal) child.kill()
      }
    }
  })

  // Keep only the tail: a failing CLI can be verbose, and this is only ever
  // used to explain an exit.
  child.stderr.on('data', chunk => {
    entry.stderr = (entry.stderr + chunk.toString()).slice(-4000)
  })

  child.on('error', err => {
    emit({
      type: 'error',
      message: `Could not start "${provider.command}". Is it installed and on PATH? (${err.message})`,
    })
    running.delete(opts.sessionId)
  })

  child.on('close', code => {
    running.delete(opts.sessionId)
    if (!entry.busy) return

    // A resume that dies without producing anything almost always means the
    // CLI no longer has that session on disk. Retry once from scratch so an old
    // chat degrades to "the agent forgot" rather than "this chat is broken".
    if (entry.resumed && !entry.sawOutput) {
      emit({ type: 'usage', warning: 'Could not resume the previous conversation; continuing without its history.' })
      const fresh = start(opts, false)
      fresh.busy = true
      fresh.child.stdin?.write(fresh.provider.encodeTurn(opts.message))
      return
    }

    emit({
      type: 'error',
      message: `The ${provider.label} CLI exited (code ${code}) before finishing.${entry.stderr ? ` ${entry.stderr.trim().slice(-500)}` : ''}`,
    })
  })

  running.set(opts.sessionId, entry)
  return entry
}

/**
 * Send one user turn, starting the CLI if this is the first.
 *
 * The process is long-lived, so the model keeps the whole conversation itself —
 * we no longer replay the transcript, and a turn needing five tool calls costs
 * one process rather than five.
 */
export function sendTurn(opts: TurnOptions): RunningSession {
  let entry = running.get(opts.sessionId)
  if (!entry || entry.child.exitCode !== null) {
    const session = getSession(opts.sessionId)
    const resume = session?.needsResume === true
    if (session) session.needsResume = false
    entry = start(opts, resume)
  }
  entry.busy = true
  entry.child.stdin?.write(entry.provider.encodeTurn(opts.message))
  return entry
}

export function isRunning(sessionId: string): boolean {
  const entry = running.get(sessionId)
  return !!entry && entry.child.exitCode === null
}

/** Drain any client-side mutations queued by tools during this turn. */
export function takeClientActions(sessionId: string) {
  return drainClientActions(sessionId)
}

export function stopSession(sessionId: string) {
  const entry = running.get(sessionId)
  if (!entry) return
  try {
    entry.child.stdin?.end()
    entry.child.kill()
  } catch {
    // Already gone.
  }
  running.delete(sessionId)
}
