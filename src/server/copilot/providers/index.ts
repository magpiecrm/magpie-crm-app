import { hasKey } from '../settings'
import type { ModelAdapter } from '../agent'
import { anthropicAdapter } from './anthropic'
import { openaiAdapter } from './openai'

const ADAPTERS: ModelAdapter[] = [anthropicAdapter, openaiAdapter]
const KEY_FIELD = { claude: 'anthropicApiKey', openai: 'openaiApiKey' } as const

/** The adapter for a provider id from the chat ("claude" or "openai"). */
export function getAdapter(id: string): ModelAdapter {
  const adapter = ADAPTERS.find((a) => a.id === id)
  if (!adapter) throw new Error(`Unknown copilot provider "${id}". Available: ${ADAPTERS.map((a) => a.id).join(', ')}.`)
  return adapter
}

/** Provider list for the chat's model picker: which ones have a key saved. */
export function listProviders() {
  return ADAPTERS.map((a) => ({
    id: a.id,
    label: a.id === 'claude' ? 'Claude' : a.label,
    keySet: hasKey(KEY_FIELD[a.id as keyof typeof KEY_FIELD]),
  }))
}

