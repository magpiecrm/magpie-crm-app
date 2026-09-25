import { spawn } from 'child_process'
import type { CopilotProvider } from './types'
import { claudeProvider } from './claude'

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

/** Provider list for the settings UI, with live availability. */
export async function listProviders() {
  return Promise.all(
    PROVIDERS.map(async p => ({
      id: p.id,
      label: p.label,
      description: p.description,
      available: await isInstalled(p),
    })),
  )
}

export type { CopilotProvider, CopilotEvent, SpawnOptions } from './types'
