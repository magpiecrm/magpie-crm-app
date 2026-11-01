import type { MailFamily, MailProvider } from './proxyRouter'

/**
 * What's known about a company's mail domain: never a person's name or
 * address. Kept apart from db.ts so the email finder can be used without it,
 * as the hosted service does.
 */
export interface EmailDomainRecord {
  domain: string
  /** e.g. `{first}.{last}`. Never stored with a name or address. */
  pattern: string | null
  pattern_confidence: number
  /** People rejected under the learned pattern since one was last verified with it: it loses confidence on the second (emailFinder.ts). */
  pattern_misses?: number
  pattern_verified_at: string | null
  catch_all: boolean | null
  catch_all_checked_at: string | null
  /**
   * What set `catch_all` to true: the verification server's own made-up
   * address in the same session (`reacher_flag`), our made-up address being
   * accepted (`probe_accepted`), or a guess's check (`candidate_flag`).
   * Missing on records flagged before this was kept.
   */
  catch_all_source?: 'reacher_flag' | 'probe_accepted' | 'candidate_flag' | 'shared' | null
  /** A second made-up address, in a separate session, was accepted too. */
  catch_all_confirmed?: boolean
  /** The catch-all test was inconclusive; don't repeat it before this. */
  catch_all_recheck_at?: string | null
  mx_provider: MailProvider | null
  /** Mailbox host or email security gateway behind the MX (finer than `mx_provider`). */
  mx_family?: MailFamily | null
  /** False when the domain has no MX records at all. */
  accepts_mail: boolean | null
  mx_checked_at: string | null
  last_used_at: string
}
