// The copilot on the host's AI (COPILOT_MANAGED, set by whoever hosts this
// copy): Claude calls go to the host's POST /v1/ai/messages at REACHER_URL,
// authorised with this copy's REACHER_SECRET, instead of to Anthropic with a
// key of the copy's own. The host chooses and enforces the model, forwards
// the Messages API request to Anthropic, and answers with Anthropic's reply
// plus what the call used of the plan's AI budget (x-magpie-ai-charge, in
// thousandths of a penny or cent). That's counted here against the `ai`
// allowance (allowance.ts), which Settings → Copilot shows as a share.
//
// To the people using it the model is "Maggy": no model name is shown.

import { requireAllowance } from '../allowance'
import { env } from '../env'
import { recordUsage } from '../usage'

/** What the copilot is called where the host runs it. */
export const MANAGED_MODEL_LABEL = 'Maggy'
/** What's asked for; the host decides (and enforces) the model and effort itself. */
export const MANAGED_MODEL = 'claude-haiku-5-5'
export const MANAGED_EFFORT = 'max'

/** The system prompt's first line where the host runs the copilot, so it answers to its name. */
export const MANAGED_NAME_LINE = `Your name is ${MANAGED_MODEL_LABEL}, the app's copilot.`

export const copilotManaged = () => env.copilotManaged()

/** The host's address for model calls, or null when this copy hasn't been given one. */
export function managedUrl(): string | null {
  const base = env.reacher.url()
  return base ? `${base}/v1/ai/messages` : null
}

/** The secret model calls are authorised with. Throws a message for the chat when the host hasn't set it up. */
export function requireManagedSecret(): string {
  const secret = env.reacher.secret()
  if (!secret || !managedUrl()) throw new Error("The copilot isn't set up on this workspace yet. Contact your hosting provider.")
  return secret
}

type Refusal = { ok: false; message: string; fatal?: boolean }

/** Null when there's AI budget left for another call; otherwise why not, for the chat. */
export function budgetRefusal(): Refusal | null {
  try {
    requireAllowance('ai')
    return null
  } catch (err: any) {
    return { ok: false, fatal: true, message: err.message }
  }
}

/** Counts a call the host answered against the AI budget. */
export function recordManagedCall(res: Response) {
  const charge = Number(res.headers.get('x-magpie-ai-charge'))
  recordUsage({ aiRequests: 1, aiCharge: Number.isFinite(charge) && charge > 0 ? Math.ceil(charge) : 0 })
}

/** The host's refusal or failure, in words for the chat. */
export async function managedError(res: Response): Promise<Refusal> {
  let code: string | undefined
  try {
    code = (await res.json())?.code
  } catch {
    // No body to read: the status says enough.
  }
  if (res.status === 402) {
    return {
      ok: false,
      fatal: true,
      message:
        code === 'no_budget'
          ? 'Your plan has no AI budget, so the copilot is off. Add one in Settings → Plan and billing.'
          : "You've used this month's AI budget. Raise it in Settings → Plan and billing, or wait for it to reset.",
    }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, fatal: true, message: "The copilot isn't available on this workspace right now. Contact your hosting provider." }
  }
  if (res.status === 429) return { ok: false, message: 'The copilot is busy. Try again in a minute.' }
  if (res.status === 529 || res.status === 503) return { ok: false, message: 'The copilot is overloaded right now. Try again in a minute.' }
  return { ok: false, message: `The copilot couldn't answer (HTTP ${res.status}). Try again in a minute.` }
}
