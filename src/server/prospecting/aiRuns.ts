// AI work that takes minutes (persona drafts, a suggested search), run here
// rather than inside the request that asked for it, so whoever asked can close
// the pop-up or leave the page and come back to find it still running, or
// finished and waiting. A run finished with nobody looking calls `onUnseen`,
// which is how the bell hears of it.
//
// One run of each kind per copy (a copy is one workspace): asking again while
// one runs joins it rather than paying for a second. A finished run is kept
// until it's used, replaced or dismissed, or for a day.
//
// In server memory only, never on disk, and a restart loses it. What's kept is
// the workspace's own website and note and the AI's answer (personas, or
// search filters): no person, and nothing found by a search.

export type AiRunKind = 'personas' | 'search'

export interface AiRunInput {
  websiteUrl: string
  note?: string
}

export interface AiRun<T> {
  id: string
  kind: AiRunKind
  status: 'running' | 'done' | 'failed'
  input: AiRunInput
  startedAt: string
  finishedAt?: string
  result?: T
  error?: string
  /** Persona drafts: which have been added, by their place in `result`. */
  added?: number[]
}

interface Held {
  run: AiRun<unknown>
  controller: AbortController
  /** When someone last asked after it: the pop-up or the page, every few seconds while it runs. */
  seenAt: number
}

/** How long a finished run is kept when nobody uses or dismisses it. */
export const HELD_MS = 24 * 60 * 60_000
/** Asked after this recently, someone's watching it finish. */
export const WATCHED_MS = 20_000

const runs = new Map<AiRunKind, Held>()

/** For tests: stop and forget every run. */
export function forgetAiRuns() {
  for (const held of runs.values()) held.controller.abort()
  runs.clear()
}

function prune(now: number) {
  for (const [kind, held] of runs) {
    if (held.run.finishedAt && now - Date.parse(held.run.finishedAt) > HELD_MS) runs.delete(kind)
  }
}

const copy = <T>(run: AiRun<unknown>) => structuredClone(run) as AiRun<T>

/** What came of the AI's failure, for the user. */
function failure(err: unknown): string {
  const e = err as { name?: string; message?: string } | null
  // AiFailed (copilot/generate.ts): this call failed, and another may not.
  if (e?.name === 'AiFailed') return `The AI couldn't finish: ${e.message} Try again in a moment.`
  return e?.message || 'Something went wrong.'
}

/** The run of this kind, or null. Asking counts as watching it. */
export function getAiRun<T>(kind: AiRunKind): AiRun<T> | null {
  const now = Date.now()
  prune(now)
  const held = runs.get(kind)
  if (!held) return null
  held.seenAt = now
  return copy<T>(held.run)
}

/**
 * Starts `work`, unless a run of this kind is already going, which is
 * returned instead. A finished one is replaced. `work` is given a signal that
 * aborts if the run is dismissed while it's going.
 */
export function startAiRun<T>(
  kind: AiRunKind,
  input: AiRunInput,
  work: (signal: AbortSignal) => Promise<T>,
  opts: { onUnseen?: (run: AiRun<T>) => void } = {},
): AiRun<T> {
  const now = Date.now()
  prune(now)
  const existing = runs.get(kind)
  if (existing?.run.status === 'running') {
    existing.seenAt = now
    return copy<T>(existing.run)
  }

  const run: AiRun<T> = { id: crypto.randomUUID(), kind, status: 'running', input, startedAt: new Date(now).toISOString() }
  const held: Held = { run, controller: new AbortController(), seenAt: now }
  runs.set(kind, held)

  const finish = (end: Pick<AiRun<T>, 'status' | 'result' | 'error'>) => {
    // Dismissed or replaced meanwhile: nobody wants it.
    if (runs.get(kind) !== held) return
    Object.assign(run, end, { finishedAt: new Date().toISOString() })
    if (Date.now() - held.seenAt <= WATCHED_MS) return
    try {
      opts.onUnseen?.(copy<T>(run))
    } catch (err) {
      console.error(`[AI runs] Telling of a finished ${kind} run failed:`, err)
    }
  }
  // Started on the next tick, so `work` throwing at once still ends as a failed run.
  Promise.resolve()
    .then(() => work(held.controller.signal))
    .then(
      (result) => finish({ status: 'done', result }),
      (err) => finish({ status: 'failed', error: failure(err) }),
    )
  return copy<T>(run)
}

/**
 * Changes the run `id` stands for, if it's still the one of this kind, and
 * returns it as it is now; null if it's gone. `change` runs at once, so
 * nothing else touches the run while it does.
 */
export function updateAiRun<T>(kind: AiRunKind, id: string, change: (run: AiRun<T>) => void): AiRun<T> | null {
  const held = runs.get(kind)
  if (!held || held.run.id !== id) return null
  change(held.run as AiRun<T>)
  held.seenAt = Date.now()
  return copy<T>(held.run)
}

/** Forgets the run `id` stands for, stopping it if it's still going. */
export function clearAiRun(kind: AiRunKind, id: string): void {
  const held = runs.get(kind)
  if (!held || held.run.id !== id) return
  runs.delete(kind)
  held.controller.abort()
}
