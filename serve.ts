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

// A variable path, so typechecking doesn't need a build first.
const { default: app } = await import(entry)

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
        return new Response(file, {
          headers: {
            // Hashed build assets never change; everything else (the service
            // worker, manifest, icons) must be re-checked.
            'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
          },
        })
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
