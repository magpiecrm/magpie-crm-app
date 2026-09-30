// TanStack Start options. Server function calls from the browser go through
// `workspaceFetch`, so a workspace that's restarting (after an update) or
// can't be reached says so, instead of the framework's "Invariant failed".

import { createStart } from '@tanstack/react-start'

export const UNREACHABLE = "Couldn't reach your workspace. It may be restarting after an update: wait a few seconds and try again."

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

export const startInstance = createStart(() => ({ serverFns: { fetch: workspaceFetch } }))
