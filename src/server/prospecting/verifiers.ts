import type { MailProvider } from './proxyRouter'
import type { CheckResult } from './reacher'

type Check = (email: string, provider: MailProvider) => Promise<CheckResult>

const definite = (r: CheckResult) => r.isCatchAll === true || r.reachability !== 'unknown'

/**
 * Primary verifier with a second opinion for its "couldn't check" answers:
 * NeverBounce first, then (if the user enabled it) Reacher for any address
 * NeverBounce couldn't reach a server for. The fallback's answer is used only
 * when it's definite; otherwise the primary's explanation stands.
 */
export function withFallback(primary: Check, fallback: Check): Check {
  return async (email, provider) => {
    const first = await primary(email, provider)
    if (definite(first)) return first
    const second = await fallback(email, provider)
    return definite(second) ? second : first
  }
}
