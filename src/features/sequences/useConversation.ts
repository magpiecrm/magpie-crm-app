import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { checkAuthFn, markConversationSeenFn, sendSequenceReplyFn, sequenceConversationFn } from '../../server/functions'
import type { ConversationView } from './types'

/**
 * One person's conversation with a sequence: reading it (which marks their
 * messages as looked at, except in a view-only session) and answering it.
 * An answer keeps its id until it's gone, so trying again after an error
 * never sends it twice.
 */
export function useConversation(sequenceId: string, enrollmentId: string | null) {
  const queryClient = useQueryClient()
  const key = queryKeys.sequences.conversation(sequenceId, enrollmentId ?? '')
  const conversation = useQuery({
    queryKey: key,
    queryFn: () => sequenceConversationFn({ data: { enrollmentId: enrollmentId! } }),
    enabled: !!enrollmentId,
    refetchInterval: 60_000,
  })
  const { data: account } = useQuery({ queryKey: queryKeys.account(), queryFn: () => checkAuthFn(), staleTime: 5 * 60_000 })

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.replies(sequenceId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sequences.enrollments(sequenceId) })
  }

  const markSeen = useMutation({
    mutationFn: (id: string) => markConversationSeenFn({ data: { enrollmentId: id } }),
    onSuccess: (result) => {
      queryClient.setQueryData<ConversationView>(key, (old) => old && { ...old, items: old.items.map((i) => (i.direction === 'in' && i.seen === false ? { ...i, seen: true } : i)) })
      if (result.changed) refreshLists()
    },
  })
  const unseen = conversation.data?.items.some((i) => i.direction === 'in' && i.seen === false) ?? false
  const viewOnly = !!account?.viewOnly
  useEffect(() => {
    if (enrollmentId && unseen && !viewOnly && !markSeen.isPending) markSeen.mutate(enrollmentId)
    // markSeen changes on every render; what matters is whether there's something new to mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentId, unseen, viewOnly])

  const [clientId, setClientId] = useState(() => crypto.randomUUID())
  const send = useMutation({
    mutationFn: (text: string) => sendSequenceReplyFn({ data: { enrollmentId: enrollmentId!, text, clientId } }),
    onSuccess: () => {
      setClientId(crypto.randomUUID())
      void queryClient.invalidateQueries({ queryKey: key })
      refreshLists()
    },
  })

  return { conversation, send, viewOnly }
}
