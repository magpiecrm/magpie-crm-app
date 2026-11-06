// Whether the AI can be used for work outside the chat (copilot/generate.ts),
// and with Claude's web tools: on the host's AI where it runs the copilot,
// else with this copy's own Anthropic or OpenAI key. Apart from generate.ts,
// which loads the model adapters (and through them the copilot's tools), so
// the sequences code can ask without importing all of that.

import { budgetRefusal, copilotManaged, requireManagedSecret } from './managedAi'
import { hasKey } from './settings'

export type AiAvailability = { ok: true; web: boolean } | { ok: false; reason: string }

/** Whether the AI can be used here, and with Claude's web tools. */
export function aiAvailable(): AiAvailability {
  if (copilotManaged()) {
    try {
      requireManagedSecret()
    } catch (err: any) {
      return { ok: false, reason: err.message }
    }
    const refused = budgetRefusal()
    return refused ? { ok: false, reason: refused.message } : { ok: true, web: true }
  }
  if (hasKey('anthropicApiKey')) return { ok: true, web: true }
  if (hasKey('openaiApiKey')) return { ok: true, web: false }
  return { ok: false, reason: 'This needs the AI: add an Anthropic or OpenAI API key in Settings → Copilot.' }
}
