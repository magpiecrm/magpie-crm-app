import { recordLimit, recordLookup } from '../usage'
import { findEmail, type FindResult } from './emailFinder'
import { isPacing, VerificationLimitError } from './proxyRouter'

/**
 * findEmail, counting which verification limit stopped it (recordLimit) and,
 * unless it was only pacing that the caller waits out (isPacing), the lookup
 * as `limit`, before the error goes on. Other outcomes are counted by the
 * caller, once the result is final.
 */
export async function findEmailCounted(...args: Parameters<typeof findEmail>): Promise<FindResult> {
  try {
    return await findEmail(...args)
  } catch (err) {
    if (err instanceof VerificationLimitError) {
      recordLimit(err.code)
      if (!isPacing(err)) recordLookup('limit')
    }
    throw err
  }
}
