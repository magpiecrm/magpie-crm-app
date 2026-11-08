import { Search } from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { Badge } from '../../../components/ui/Badge'
import { Select } from '../../../components/ui/Select'
import { INPUT_CLASS } from '../../../components/ui/Field'
import type { InboxList, InboxRow, MissingReply } from '../../sequences/types'
import { when } from '../time'

const DEAL_BADGE = { open: 'info', won: 'success', lost: 'default' } as const

/** What a row says with none of their words to show. */
const MISSING: Record<NonNullable<MissingReply>, string> = {
  pending: 'Their reply shows once the inbox has been read',
  not_found: "Their reply wasn't found in the inbox",
  manual: 'Marked as replied by hand',
}

/** The left side of the inbox: the tabs, a sequence and a search to narrow it, and each conversation. */
export function ConversationList({
  data,
  rows,
  loading,
  error,
  tab,
  onTab,
  sequence,
  onSequence,
  search,
  onSearch,
  selected,
  onSelect,
}: {
  data?: InboxList
  rows: InboxRow[]
  loading: boolean
  error?: Error | null
  tab: 'needs_reply' | 'all'
  onTab: (tab: 'needs_reply' | 'all') => void
  sequence?: string
  onSequence: (id: string | undefined) => void
  search: string
  onSearch: (q: string) => void
  selected?: string
  onSelect: (id: string) => void
}) {
  return (
    <>
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-display text-foreground">Inbox</h1>
        </div>
        <div role="tablist" aria-label="Which conversations" className="flex gap-1 rounded-md-s bg-muted p-1">
          {(
            [
              ['needs_reply', 'Needs reply'],
              ['all', 'All replies'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => onTab(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-[7px] px-3 py-1.5 text-sm transition-colors cursor-pointer ${
                tab === id ? 'bg-card font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
              {id === 'needs_reply' && data && data.needs_reply > 0 && <span className="tabular-nums text-xs text-muted-foreground">{data.needs_reply}</span>}
            </button>
          ))}
        </div>
        <Select value={sequence ?? ''} onChange={(e) => onSequence(e.target.value || undefined)} className={INPUT_CLASS} aria-label="Sequence">
          <option value="">All sequences</option>
          {(data?.sequences ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <label className="relative block">
          <span className="sr-only">Search conversations</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search by name, company or email" className={`${INPUT_CLASS} pl-9`} />
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {error ? (
          <p className="p-4 text-sm text-destructive">{error.message}</p>
        ) : loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {search.trim()
              ? 'No conversations match that search.'
              : tab === 'needs_reply'
                ? 'Nobody is waiting for an answer.'
                : 'No replies yet. When someone answers a sequence email, the conversation shows here.'}
          </p>
        ) : (
          <ul>
            {rows.map((c) => {
              const who = c.name ?? c.email
              const bold = c.needs_reply || c.unread > 0
              return (
                <li key={c.enrollment_id} className="border-b border-border">
                  <button
                    onClick={() => onSelect(c.enrollment_id)}
                    aria-current={selected === c.enrollment_id ? 'true' : undefined}
                    className={`flex w-full gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${selected === c.enrollment_id ? 'bg-muted' : 'hover:bg-muted/60'}`}
                  >
                    <Avatar name={who} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={`truncate text-sm text-foreground ${bold ? 'font-semibold' : 'font-medium'}`}>{who}</span>
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{when(c.at)}</span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{[c.title, c.company].filter(Boolean).join(' · ') || c.email}</span>
                      <span className={`mt-1 line-clamp-2 text-sm ${bold ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {c.last ? (
                          <>
                            {c.last.direction === 'out' && <span className="text-muted-foreground">You: </span>}
                            {c.last.snippet || '(no text)'}
                          </>
                        ) : (
                          <span className="text-muted-foreground">{c.missing_reply ? MISSING[c.missing_reply] : ''}</span>
                        )}
                      </span>
                      <span className="mt-1.5 flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs text-muted-foreground">{c.sequence.name}</span>
                        {c.deal && <Badge variant={DEAL_BADGE[c.deal.status]}>{c.deal.stage || c.deal.name}</Badge>}
                      </span>
                    </span>
                    {c.needs_reply && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Needs a reply" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
