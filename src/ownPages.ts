// Calls only this copy's own pages make: every server function (src/start.ts)
// and the routes that go by the session cookie. Each of those routes lists
// `ownPagesRoute` itself, so that no other spelling of its path gets round it.
//
// The cookie's SameSite=Lax doesn't stop a page on a sibling subdomain, which
// counts as the same site. The framework only adds this check itself where
// there's no start instance, so it has to be named here. The public and token
// routes go without: they're meant to be called from elsewhere.

import { createCsrfMiddleware, createServerOnlyFn } from '@tanstack/react-start'

export const OTHER_SITE_REFUSED = "That didn't come from this workspace's own pages, so it was refused. Reload the page and try again."

// Wrapped so the client build drops the body, and with it auth.server.
const isOwnOrigin = createServerOnlyFn(async (origin: string, request: Request) => {
  const { isOwnOrigin } = await import('./server/auth.server')
  return isOwnOrigin(origin, request)
})

// The filter's plain type: the framework's own goes through Register, which comes from start.ts, which imports this.
const ownPages = (filter?: (ctx: { handlerType: string }) => boolean) =>
  createCsrfMiddleware({
    filter,
    origin: (origin, { request }) => isOwnOrigin(origin, request),
    failureResponse: ({ request, pathname, handlerType }) => {
      const seen = ['sec-fetch-site', 'origin'].map((name) => `${name}=${request.headers.get(name)}`).join(' ')
      console.warn(`[csrf] Refused ${pathname}: ${seen}`)
      // Plain text for a server function: its client throws that as the error's
      // message, but would return JSON as a result. The routes' callers read `error`.
      if (handlerType === 'serverFn') return new Response(OTHER_SITE_REFUSED, { status: 403 })
      return Response.json({ error: OTHER_SITE_REFUSED }, { status: 403 })
    },
  })

/** Every server function, from `requestMiddleware` in src/start.ts. */
export const ownPagesFunctions = ownPages(({ handlerType }) => handlerType === 'serverFn')

/** For a route that goes by the session cookie: `server: { middleware: [ownPagesRoute], handlers }`. */
export const ownPagesRoute = ownPages()
