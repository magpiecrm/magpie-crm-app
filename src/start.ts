// TanStack Start options. Server function calls from the browser go through
// `workspaceFetch`, so a workspace that's restarting (after an update) or
// can't be reached says so, instead of the framework's "Invariant failed".
//
// A view-only session (see viewOnly.ts) is refused here, before anything else
// runs: every server function that isn't a GET, and every other request that
// isn't a GET, so whatever is added later is covered without saying so. Which
// session a request has is always read from its cookie, never from middleware
// context, which the browser can add to.
//
// Server functions answer this copy's own pages and nothing else. The session
// cookie's SameSite=Lax doesn't stop a page on a sibling subdomain, which counts
// as the same site. The framework only adds this check itself where there's no
// start instance, so it has to be named here. Routes are left out: the public
// and token ones are meant to be called from elsewhere.

import { createCsrfMiddleware, createMiddleware, createServerOnlyFn, createStart } from '@tanstack/react-start'
import { VIEW_ONLY_REFUSED, VIEW_ONLY_REFUSED_EVENT, viewOnlyMayCall } from './viewOnly'

export const UNREACHABLE = "Couldn't reach your workspace. It may be restarting after an update: wait a few seconds and try again."
export const OTHER_SITE_REFUSED = "That didn't come from this workspace's own pages, so it was refused. Reload the page and try again."

/**
 * Fetch for server function calls. A dropped connection, or a reply that
 * isn't from the app (a proxy's error page while the workspace restarts:
 * no content type, or a 502-504 that isn't the app's JSON), becomes
 * UNREACHABLE.
 */
export async function workspaceFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    throw new Error(UNREACHABLE)
  }
  const type = res.headers.get('content-type') ?? ''
  // The app's own replies, errors included, are JSON (or its framed stream).
  if (!type || (res.status >= 502 && res.status <= 504 && !/json|tss/i.test(type))) throw new Error(UNREACHABLE)
  return res
}

// Wrapped so the client build drops the body, and with it auth.server.
const isOwnOrigin = createServerOnlyFn(async (origin: string, request: Request) => {
  const { isOwnOrigin } = await import('./server/auth.server')
  return isOwnOrigin(origin, request)
})

const otherSiteFunctions = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === 'serverFn',
  origin: (origin, { request }) => isOwnOrigin(origin, request),
  // Plain text: the client throws this as the error's message. JSON would come back as a result.
  failureResponse: ({ request }) => {
    const seen = ['sec-fetch-site', 'origin'].map((name) => `${name}=${request.headers.get(name)}`).join(' ')
    console.warn(`[csrf] Refused a server function call: ${seen}`)
    return new Response(OTHER_SITE_REFUSED, { status: 403 })
  },
})

const viewOnlyFunctions = createMiddleware({ type: 'function' })
  .client(async ({ next }) => {
    try {
      return await next()
    } catch (err) {
      if (typeof window !== 'undefined' && (err as Error)?.message === VIEW_ONLY_REFUSED) window.dispatchEvent(new Event(VIEW_ONLY_REFUSED_EVENT))
      throw err
    }
  })
  .server(async ({ next, method, serverFnMeta }) => {
    if (viewOnlyMayCall(method, serverFnMeta)) return next()
    const { inViewOnlySession } = await import('./server/auth.server')
    if (inViewOnlySession()) throw new Error(VIEW_ONLY_REFUSED)
    return next()
  })

const viewOnlyRoutes = createMiddleware().server(async ({ next, request, handlerType }) => {
  if (handlerType !== 'router' || request.method === 'GET' || request.method === 'HEAD' || !request.headers.has('cookie')) return next()
  const { isViewOnly, sessionFrom } = await import('./server/auth.server')
  if (isViewOnly(sessionFrom(request))) return Response.json({ error: VIEW_ONLY_REFUSED }, { status: 403 })
  return next()
})

export const startInstance = createStart(() => ({
  serverFns: { fetch: workspaceFetch },
  functionMiddleware: [viewOnlyFunctions],
  requestMiddleware: [otherSiteFunctions, viewOnlyRoutes],
}))
