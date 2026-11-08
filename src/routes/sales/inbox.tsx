import { useDeferredValue, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Inbox as InboxIcon } from 'lucide-react'
import { queryKeys } from '../../queryKeys'
import { inboxFn } from '../../server/functions'
import { ConversationList } from '../../features/inbox/components/ConversationList'
import { Conversation } from '../../features/inbox/components/Conversation'

// Replies to sequences, and the conversations since (server/sequences/
// conversation.ts): the list on the left, the one chosen on the right (one
// at a time on a phone).

export const Route = createFileRoute('/sales/inbox')({
  validateSearch: (search: Record<string, unknown>): { tab?: 'all'; id?: string; sequence?: string } => ({
    tab: search.tab === 'all' ? 'all' : undefined,
    id: typeof search.id === 'string' && search.id ? search.id : undefined,
    sequence: typeof search.sequence === 'string' && search.sequence ? search.sequence : undefined,
  }),
  component: InboxPage,
})

function InboxPage() {
  const { tab, id, sequence } = Route.useSearch()
  const navigate = useNavigate({ from: '/sales/inbox' })
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search).trim().toLowerCase()
  const filters = { needsReply: tab === 'all' ? undefined : true, sequenceId: sequence }
  const { data, isLoading, error } = useQuery({ queryKey: queryKeys.inbox.list(filters), queryFn: () => inboxFn({ data: filters }), refetchInterval: 60_000 })
  const rows = useMemo(
    () => (data?.rows ?? []).filter((c) => !q || [c.name ?? '', c.email, c.company ?? '', c.title ?? ''].some((v) => v.toLowerCase().includes(q))),
    [data, q],
  )

  return (
    <div className="flex min-h-0" style={{ height: 'calc(100dvh - 4rem - env(safe-area-inset-top, 0px))' }}>
      <section className={`${id ? 'hidden md:flex' : 'flex'} min-h-0 w-full shrink-0 flex-col border-r border-border bg-card md:w-80 lg:w-96`}>
        <ConversationList
          data={data}
          rows={rows}
          loading={isLoading}
          error={error}
          tab={tab === 'all' ? 'all' : 'needs_reply'}
          onTab={(t) => navigate({ search: (s) => ({ ...s, tab: t === 'all' ? 'all' : undefined }) })}
          sequence={sequence}
          onSequence={(seq) => navigate({ search: (s) => ({ ...s, sequence: seq }) })}
          search={search}
          onSearch={setSearch}
          selected={id}
          onSelect={(next) => navigate({ search: (s) => ({ ...s, id: next }) })}
        />
      </section>
      <section className={`${id ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
        {id ? (
          <Conversation key={id} id={id} onBack={() => navigate({ search: (s) => ({ ...s, id: undefined }) })} />
        ) : (
          <div className="m-auto max-w-sm p-6 text-center">
            <InboxIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Pick a conversation</p>
            <p className="mt-1 text-sm text-muted-foreground">Replies to your sequences land here, read from each sender's connected inbox. Answer them here and they go in the same thread.</p>
          </div>
        )}
      </section>
    </div>
  )
}
