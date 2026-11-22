/// <reference types="bun" />
// Production server: `bun run build`, then `bun serve.ts` (or `bun run start`).
//
// Serves the built client files from dist/client and hands everything else to
// the built TanStack Start handler. It replaces `vite preview`, which also
// loads Vite's build tooling and uses about twice the memory (measured: ~180 MB
// against ~320 MB for an empty account), which matters when every hosted
// customer runs their own copy.
//
// PORT (default 3000) and HOST (default 0.0.0.0) set where it listens. The
// routes that must be reachable from other sites (signup forms, form embeds)
// set their own CORS headers.

import { resolve, sep } from 'path'

const root = import.meta.dir
const clientDir = resolve(root, 'dist/client')
const entry = resolve(root, 'dist/server/server.js')

// DNS_SERVERS (comma-separated; `host:port` allowed) sends the app's own DNS
// lookups (MX records, a sending domain's SPF/DKIM/DMARC, a mailbox's mail
// server) there instead of the system's resolvers: the test stack's stand-in
// (test/stack), or a resolver of the host's choosing.
if (process.env.DNS_SERVERS) {
  const { setServers } = await import('node:dns')
  setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean))
}

// A variable path, so typechecking doesn't need a build first.
const { default: app } = await import(entry)

// The sign-in page, asked for once before listening: it opens the data file, so one
// that can't be read stops the app here (src/server/db.ts) rather than at the first
// visitor, and the background jobs start now rather than then.
await Promise.resolve(app.fetch(new Request('http://127.0.0.1/login'))).catch((err: any) =>
  console.error('[serve] First page failed:', err?.message ?? err),
)

/** A built client file for this path, or null. Never anything outside dist/client. */
async function clientFile(pathname: string) {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded === '/' || decoded.includes('\0')) return null
  const path = resolve(clientDir, `.${decoded}`)
  if (!path.startsWith(clientDir + sep)) return null
  const file = Bun.file(path)
  return (await file.exists()) ? file : null
}

const server = Bun.serve({
  port: Number(process.env.PORT) || 3000,
  hostname: process.env.HOST || '0.0.0.0',
  // Copilot replies and save jobs can stream for minutes.
  idleTimeout: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' || request.method === 'HEAD') {
      const file = await clientFile(pathname)
      if (file) {
        const headers = {
          // Hashed build assets never change. The embed scripts run on every page view of every site they're
          // pasted on, so browsers keep them for five minutes; everything else (the service worker, manifest,
          // icons) is re-checked each time.
          'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : pathname.endsWith('/embed.js') ? 'public, max-age=300' : 'no-cache',
          'Last-Modified': new Date(file.lastModified).toUTCString(),
        }
        // A re-check of a file that hasn't changed since is answered without sending it again.
        const since = Date.parse(request.headers.get('if-modified-since') ?? '')
        if (since >= Math.floor(file.lastModified / 1000) * 1000) return new Response(null, { status: 304, headers })
        return new Response(file, { headers })
      }
    }
    try {
      return await app.fetch(request)
    } catch (err: any) {
      console.error('[serve] Unhandled error:', err?.message ?? err)
      return new Response('Internal Server Error', { status: 500 })
    }
  },
})

console.log(`[serve] Listening on http://${server.hostname}:${server.port}`)

// Save usage counts still waiting to be written (see src/server/usage.ts)
// before the process stops, e.g. on `docker stop` or a redeploy.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    ;(globalThis as any).__usageFlush?.()
    server.stop()
    process.exit(0)
  })
}
