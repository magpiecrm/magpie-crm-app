import { spawn } from 'child_process'
import type { CopilotProvider } from './types'
import { claudeProvider } from './claude'
import { hasKey } from '../settings'

const PROVIDERS: CopilotProvider[] = [claudeProvider]

const byId = new Map(PROVIDERS.map(p => [p.id, p]))

/**
 * Resolve a provider id to its definition.
 *
 * Everything downstream spawns `provider.command`, never the caller's string,
 * so an unknown id fails here rather than becoming an arbitrary executable.
 */
export function getProvider(id: string): CopilotProvider {
  const provider = byId.get(id)
  if (!provider) {
    throw new Error(`Unknown copilot provider "${id}". Available: ${[...byId.keys()].join(', ')}.`)
  }
  return provider
}

/** Whether the provider's CLI is actually installed and on PATH. */
export function isInstalled(provider: CopilotProvider): Promise<boolean> {
  return new Promise(resolve => {
    const probe = spawn(provider.command, ['--version'], { stdio: 'ignore' })
    probe.on('error', () => resolve(false))
    probe.on('close', code => resolve(code === 0))
  })
}

/**
 * Provider list for the settings UI and the chat's model picker.
 * `available`: it can run on this server (Claude needs its CLI installed;
 * OpenAI runs in-process). `keySet`: the user's API key for it is saved.
 */
export async function listProviders() {
  const claude = await Promise.all(
    PROVIDERS.map(async p => ({
      id: p.id,
      label: p.label,
      description: p.description,
      available: await isInstalled(p),
      keySet: hasKey('anthropicApiKey'),
    })),
  )
  return [
    ...claude,
    {
      id: 'openai',
      label: 'OpenAI',
      description: 'Calls OpenAI models on the API with your own OpenAI API key.',
      available: true,
      keySet: hasKey('openaiApiKey'),
    },
  ]
}

export type { CopilotProvider, CopilotEvent, SpawnOptions } from './types'
