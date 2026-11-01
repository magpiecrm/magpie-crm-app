// A view-only session: one of the host's staff looking at this copy from their
// admin portal (server/signInLink.ts). It reads everything and changes nothing.
// src/start.ts does the refusing; this is what that and the page share.

export const VIEW_ONLY_REFUSED = 'View-only session: nothing was changed.'
/** Fired on the window when a server function is refused, for the banner to say so. */
export const VIEW_ONLY_REFUSED_EVENT = 'view-only-refused'

/** The server functions that aren't GETs and a view-only session may still call: signing out, and a read that takes a big body. */
const ALLOWED = ['src/server/functions/auth.ts#logoutFn', 'src/server/functions/sequences.ts#previewSequenceStepFn']

/** Whether a view-only session may call this server function. Anything new that writes is refused without being listed. */
export const viewOnlyMayCall = (method: string, fn: { name: string; filename: string }) =>
  method === 'GET' || ALLOWED.includes(`${fn.filename}#${fn.name}`)
