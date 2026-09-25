import { createServerFn } from '@tanstack/react-start'

// The agent loop that used to live here — a one-shot `claude -p` invocation
// whose reply was scraped for a JSON blob, re-spawned once per tool call — has
// been replaced by `src/server/copilot/`: a long-lived CLI session driven over
// stream-json, with the platform's actions exposed as real MCP tools. See
// `src/routes/api/copilot/stream.ts` for the entry point.
//
// What remains here is CLI *authentication*, which is still a shell-out.

interface ActiveAuth {
  child: any
  stdout: string
  stderr: string
  url: string | null
  resolvePromise: ((val: any) => void) | null
}

// Store on globalThis so it survives module re-evaluation (Vite HMR / multi-import)
const GLOBAL_AUTH_KEY = Symbol.for('tanstack-start:claude-active-auth')
const g = globalThis as any
if (!g[GLOBAL_AUTH_KEY]) g[GLOBAL_AUTH_KEY] = null

function getActiveAuth(): ActiveAuth | null { return g[GLOBAL_AUTH_KEY] }
function setActiveAuth(val: ActiveAuth | null) { g[GLOBAL_AUTH_KEY] = val }

export const checkClaudeStatusFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()

    const { exec } = await import('child_process')
    return new Promise<any>((resolve) => {
      exec('claude auth status', (_err, stdout) => {
        try {
          const parsed = JSON.parse(stdout.trim())
          resolve({ success: true, status: parsed })
        } catch (e) {
          resolve({ success: true, status: { loggedIn: false, error: 'Could not parse status' } })
        }
      })
    })
  })

export const startClaudeLoginFn = createServerFn({ method: 'POST' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()

    const { spawn } = await import('child_process')

    const prev = getActiveAuth()
    if (prev && prev.child) {
      try { prev.child.kill() } catch (e) {}
    }

    const auth: ActiveAuth = { child: null, stdout: '', stderr: '', url: null, resolvePromise: null }
    setActiveAuth(auth)

    return new Promise<any>((resolve) => {
      const child = spawn('claude', ['auth', 'login'], { stdio: ['pipe', 'pipe', 'pipe'] })
      auth.child = child

      let urlSent = false

      const checkOutput = (data: string) => {
        const a = getActiveAuth()
        if (!a) return
        a.stdout += data
        const match = a.stdout.match(/(https:\/\/claude\.com\/cai\/oauth\/authorize[^\s\n\r]*)/)
        if (match && !urlSent) {
          urlSent = true
          a.url = match[0]
          resolve({ success: true, url: match[0], promptCode: true })
        }
      }

      child.stdout.on('data', (chunk) => checkOutput(chunk.toString()))
      child.stderr.on('data', (chunk) => checkOutput(chunk.toString()))

      child.on('close', (code) => {
        if (!urlSent) {
          resolve({ success: false, error: `Process exited with code ${code}` })
        }
        const a = getActiveAuth()
        if (a && a.resolvePromise) {
          a.resolvePromise({ success: false, error: `Process exited with code ${code}` })
        }
        setActiveAuth(null)
      })

      setTimeout(() => {
        if (!urlSent) {
          try { child.kill() } catch (e) {}
          resolve({ success: false, error: 'Timeout waiting for authorization URL' })
          setActiveAuth(null)
        }
      }, 10000)
    })
  })

export const submitClaudeCodeFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()

    const { code } = data
    const auth = getActiveAuth()

    if (!auth || !auth.child) {
      return { success: false, error: 'No active login session. Please click "Authenticate Claude CLI" first.' }
    }

    return new Promise<any>((resolve) => {
      auth.resolvePromise = resolve

      auth.child.stdin.write(`${code}\n`)

      let finished = false

      const checkResult = () => {
        const a = getActiveAuth()
        if (!a || finished) return
        const out = a.stdout.toLowerCase()
        if (out.includes('success') || out.includes('signed in') || out.includes('logged in')) {
          finished = true
          resolve({ success: true, output: a.stdout })
          setActiveAuth(null)
        }
      }

      auth.child.stdout.on('data', (chunk: any) => {
        const a = getActiveAuth()
        if (!a) return
        a.stdout += chunk.toString()
        checkResult()
      })

      auth.child.on('close', (exitCode: any) => {
        if (finished) return
        finished = true
        const a = getActiveAuth()
        if (exitCode === 0) {
          resolve({ success: true, output: a ? a.stdout : 'Success' })
        } else {
          resolve({ success: false, error: `Login failed (exit code ${exitCode})`, output: a ? a.stdout : '' })
        }
        setActiveAuth(null)
      })

      setTimeout(() => {
        if (!finished) {
          finished = true
          const a = getActiveAuth()
          if (a && a.child) {
            try { a.child.kill() } catch (e) {}
          }
          resolve({ success: false, error: 'Timeout waiting for verification. Try logging in again.' })
          setActiveAuth(null)
        }
      }, 60000)
    })
  })

export const logoutClaudeFn = createServerFn({ method: 'POST' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()

    const { exec } = await import('child_process')
    return new Promise<any>((resolve) => {
      exec('claude auth logout', (err, stdout) => {
        resolve({ success: !err, output: stdout })
      })
    })
  })



export const getCopilotProvidersFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { listProviders } = await import('../copilot/providers')
    const { PERMISSION_MODES, DEFAULT_PERMISSION_MODE } = await import('../copilot/permissions')
    return {
      providers: await listProviders(),
      permissionModes: PERMISSION_MODES,
      defaultPermissionMode: DEFAULT_PERMISSION_MODE,
    }
  })

export const listCopilotChatsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { db } = await import('../db')
    return { chats: db.getCopilotChats() }
  })

export const getCopilotChatFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { db } = await import('../db')
    const chat = db.getCopilotChat(data.id)
    if (!chat) return { chat: null }
    return {
      chat: {
        id: chat.id,
        title: chat.title,
        messages: chat.messages,
        updatedAt: chat.updated_at,
      },
    }
  })

export const deleteCopilotChatFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { db } = await import('../db')
    const { stopSession } = await import('../copilot/session')
    const { endSession } = await import('../copilot/state')
    // Kill the agent process too, or it lingers until the idle sweep.
    stopSession(data.id)
    endSession(data.id)
    db.deleteCopilotChat(data.id)
    return { success: true }
  })
