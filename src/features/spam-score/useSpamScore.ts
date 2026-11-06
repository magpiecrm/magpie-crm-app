import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { campaignSpamScoreFn, sequenceSpamScoreFn } from '../../server/functions'
import { queryKeys } from '../../queryKeys'
import type { SpamScore } from './types'
import type { SequenceSettings } from '../sequences/types'

/** The value once it has stopped changing for `ms`, so typing doesn't score every keystroke. */
function useSettled<T>(value: T, ms = 800): T {
  const [settled, setSettled] = useState(value)
  const json = JSON.stringify(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, ms])
  return settled
}

/** A short key for what's scored (FNV-1a), so the query key isn't the whole email. */
function keyOf(value: unknown): string {
  const s = JSON.stringify(value)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return `${(h >>> 0).toString(36)}-${s.length}`
}

export interface CampaignSpamDraft {
  subject: string
  previewText?: string | null
  htmlContent: string
  senderId?: number | null
  listId?: number | null
  trackOpens: boolean
  unsubscribeEnabled: boolean
}

/** A campaign draft's spam score, kept while a newer one loads. Nothing until it has a design. */
export function useCampaignSpamScore(draft: CampaignSpamDraft, enabled = true) {
  const settled = useSettled(draft)
  return useQuery<SpamScore>({
    queryKey: queryKeys.email.spamScore(keyOf(settled)),
    queryFn: () => campaignSpamScoreFn({ data: settled }),
    enabled: enabled && Boolean(settled.htmlContent.trim()),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export interface SequenceSpamDraft {
  steps?: Array<{ subject: string | null; body: string }>
  settings?: Partial<SequenceSettings>
}

/** A sequence's spam score, with the steps and settings being edited when given. */
export function useSequenceSpamScore(id: string, draft: SequenceSpamDraft = {}, enabled = true) {
  const settled = useSettled(draft)
  return useQuery<SpamScore>({
    queryKey: queryKeys.sequences.spamScore(id, keyOf(settled)),
    queryFn: () => sequenceSpamScoreFn({ data: { id, ...settled } }),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}
