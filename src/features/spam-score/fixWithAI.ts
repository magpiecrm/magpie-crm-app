// "Fix with AI": the request the spam score card hands the copilot, and
// whether there's a copilot to hand it to.

import { useQuery } from '@tanstack/react-query'
import { getCopilotProvidersFn } from '../../server/functions'
import { queryKeys } from '../../queryKeys'
import type { SpamScore } from './types'

/** The copilot can answer here: the host runs it, or an API key is set. */
export function useCopilotReady(): boolean {
  const { data } = useQuery({ queryKey: queryKeys.copilot.providers(), queryFn: () => getCopilotProvidersFn(), staleTime: 60_000 })
  return Boolean(data && (data.managed || data.providers.some((p) => p.keySet)))
}

/**
 * Asks for what the email itself can change, and nothing more: the offer,
 * facts and tone stay. Sender and recipient findings go along so the copilot
 * can explain them, not "fix" them.
 */
export function spamFixPrompt(
  what: { kind: 'campaign'; id?: number; name: string; inBuilder?: boolean } | { kind: 'sequence'; id: string; name: string },
  score: SpamScore,
): string {
  const fixable = score.findings.filter((f) => f.fixable && f.points > 0)
  const other = score.findings.filter((f) => !f.fixable && (f.points > 0 || f.hard))
  const where =
    what.kind === 'sequence'
      ? `the sequence "${what.name}" (id ${what.id})`
      : what.inBuilder
        ? `the campaign "${what.name}" open in the email builder`
        : `the campaign "${what.name}" (id ${what.id})`
  const check =
    what.kind === 'sequence'
      ? `checkSpamScore for sequence ${what.id}`
      : what.id
        ? `checkSpamScore for campaign ${what.id}`
        : 'compileEmail'
  const line = (f: SpamScore['findings'][number]) => `- ${f.step ? `Email ${f.step}: ` : ''}${f.text} ${f.fix}`
  return [
    `Lower the spam score of ${where}: it's ${score.score} out of 100 (${score.level} risk). Fix only these, in its words, links and design${what.kind === 'sequence' ? ' and tracking settings' : ''}:`,
    ...fixable.map(line),
    '',
    "Keep the offer, the facts and the tone, and add no new claims. If one can't be fixed without changing what it says, ask me first.",
    `Then run ${check} and tell me the new score.`,
    ...(other.length ? ['', "For context, these count too but editing the email won't change them (tell me what to do about them):", ...other.map(line)] : []),
  ].join('\n')
}
