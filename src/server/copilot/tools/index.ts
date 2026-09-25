import type { CopilotTool } from '../types'
import { listTools } from './lists'
import { contactTools } from './contacts'
import { campaignTools } from './campaigns'
import { builderTools } from './builder'
import { personaTools } from './personas'
import { prospectTools } from './prospects'
import { brandTools } from './brand'
import { mediaTools } from './media'
import { surveyTools } from './surveys'
import { surveyBuilderTools } from './surveyBuilder'
import { templateTools } from './templates'

/**
 * Every tool the copilot can call. This array is the single source of truth:
 * the MCP server, the runtime validation, the permission gate, and the
 * generated prompt reference all read from it, so a tool cannot exist in one
 * place and be missing from another.
 */
export const COPILOT_TOOLS: CopilotTool<any>[] = [
  ...listTools,
  ...contactTools,
  ...campaignTools,
  ...builderTools,
  ...templateTools,
  ...personaTools,
  ...prospectTools,
  ...brandTools,
  ...mediaTools,
  ...surveyTools,
  ...surveyBuilderTools,
]

const byName = new Map(COPILOT_TOOLS.map(t => [t.name, t]))

export function getTool(name: string): CopilotTool<any> | undefined {
  return byName.get(name)
}

export function toolNames(): string[] {
  return COPILOT_TOOLS.map(t => t.name)
}

// Fail loudly at import time rather than shipping a registry with a duplicate
// that silently shadows another tool.
if (byName.size !== COPILOT_TOOLS.length) {
  const seen = new Set<string>()
  const dupes = COPILOT_TOOLS.map(t => t.name).filter(n => (seen.has(n) ? true : (seen.add(n), false)))
  throw new Error(`Duplicate copilot tool names: ${[...new Set(dupes)].join(', ')}`)
}
