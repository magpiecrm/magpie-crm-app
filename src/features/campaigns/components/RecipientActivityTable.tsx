import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { Pagination } from '../../../components/ui/Pagination'
import {
  RECIPIENT_FILTERS,
  OUTCOME_BADGE,
  OUTCOME_LABEL,
  lastActivity,
  linkLabel,
  shortTime,
  type RecipientActivity,
  type RecipientFilter,
} from '../results'

/**
 * The people behind a tab's numbers: filter by outcome or by a link they
 * clicked, search, and open a row for its times and links.
 */
export function RecipientActivityTable({
  title,
  recipients,
  filters,
  link = null,
  onClearLink,
  empty = 'Nobody here yet.',
}: {
  title: string
  recipients: RecipientActivity[]
  /** The filters offered as chips, the first selected; with one, no chips are shown. */
  filters: RecipientFilter[]
  /** Only people who clicked this link, when set. */
  link?: string | null
  onClearLink?: () => void
  empty?: string
}) {
  const [filter, setFilter] = useState(filters[0])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)
  const [expanded, setExpanded] = useState<string | null>(null)

  const counts = useMemo(
    () => Object.fromEntries(RECIPIENT_FILTERS.map((f) => [f.id, recipients.filter(f.test).length])) as Record<RecipientFilter, number>,
    [recipients],
  )

  const rows = useMemo(() => {
    const test = RECIPIENT_FILTERS.find((f) => f.id === filter)!.test
    const q = query.trim().toLowerCase()
    return recipients
      .filter(test)
      .filter((r) => !link || r.links.some((l) => l.url === link))
      .filter((r) => !q || [r.email, r.name, r.company].some((v) => v?.toLowerCase().includes(q)))
      .sort((a, b) => b.clicks - a.clicks || b.opens - a.opens || (lastActivity(b) ?? '').localeCompare(lastActivity(a) ?? ''))
  }, [recipients, filter, link, query])

  const pageRows = rows.slice((page - 1) * perPage, page * perPage)
  const go = (f: RecipientFilter) => {
    setFilter(f)
    setPage(1)
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border space-y-3">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {filters.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {RECIPIENT_FILTERS.filter((f) => filters.includes(f.id)).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => go(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                filter === f.id ? 'bg-accent/10 border-accent/40 text-accent' : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-48">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="Search name, email or company"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </label>
          {link && (
            <span className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg bg-accent/10 text-accent text-xs font-semibold max-w-full">
              <span className="truncate">Clicked {linkLabel(link)}</span>
              <button type="button" onClick={onClearLink} aria-label="Show everyone" className="p-0.5 rounded hover:bg-accent/15">
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <>
          <ul className="md:hidden divide-y divide-border">
            {pageRows.map((r) => (
              <li key={r.email} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <Who r={r} />
                  <Badge variant={OUTCOME_BADGE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge>
                </div>
                <Details r={r} />
              </li>
            ))}
          </ul>

          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20 text-xs font-semibold text-muted-foreground text-left">
                <th className="pl-4 pr-2 py-3 w-8" />
                <th className="px-2 py-3">Recipient</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Opens</th>
                <th className="px-4 py-3 text-right">Clicks</th>
                <th className="px-4 py-3 text-right">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.map((r) => {
                const open = expanded === r.email
                return (
                  <Fragment key={r.email}>
                    <tr onClick={() => setExpanded(open ? null : r.email)} className="cursor-pointer hover:bg-muted/30">
                      <td className="pl-4 pr-2 py-3 text-muted-foreground">
                        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </td>
                      <td className="px-2 py-3 max-w-0 w-[40%]"><Who r={r} /></td>
                      <td className="px-4 py-3">
                        <Badge variant={OUTCOME_BADGE[r.outcome]}>
                          {OUTCOME_LABEL[r.outcome]}
                          {r.bounce && ` (${r.bounce})`}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.opens || <span className="text-muted-foreground">–</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.clicks || <span className="text-muted-foreground">–</span>}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">{shortTime(lastActivity(r))}</td>
                    </tr>
                    {open && (
                      <tr className="bg-muted/20">
                        <td />
                        <td colSpan={5} className="px-2 pb-4 pt-1"><Details r={r} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>

          {rows.length > 25 && (
            <div className="border-t border-border p-3">
              <Pagination
                totalItems={rows.length}
                itemsPerPage={perPage}
                onItemsPerPageChange={(n) => {
                  setPerPage(n)
                  setPage(1)
                }}
                currentPage={page}
                onPageChange={setPage}
                itemsPerPageOptions={[25, 50, 100, 250]}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Who({ r }: { r: RecipientActivity }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-foreground truncate">{r.name || r.email}</p>
      <p className="text-xs text-muted-foreground truncate">
        {r.name ? r.email : null}
        {r.name && r.company ? ' · ' : null}
        {r.company}
      </p>
    </div>
  )
}

/** When it went out, the opens and clicks, and the links, for one recipient. */
function Details({ r }: { r: RecipientActivity }) {
  const facts = [
    ['Sent', r.sentAt],
    ['First opened', r.openedAt],
    ['Last opened', r.opens > 1 ? r.lastOpenedAt : null],
    ['First clicked', r.clickedAt],
    [r.outcome === 'complained' ? 'Marked as spam' : 'Unsubscribed', r.unsubscribedAt],
    [r.bounce === 'hard' ? 'Bounced (hard)' : 'Bounced', r.bouncedAt],
  ].filter((f): f is [string, string] => Boolean(f[1]))

  return (
    <div className="space-y-2 text-xs">
      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          {facts.map(([label, at]) => (
            <div key={label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-foreground tabular-nums">{shortTime(at)}</dd>
            </div>
          ))}
        </dl>
      )}
      {r.links.length > 0 && (
        <ul className="space-y-1">
          {r.links.map((l) => (
            <li key={l.url} className="flex items-baseline gap-2 min-w-0">
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-accent hover:underline truncate"
                title={l.url}
              >
                {linkLabel(l.url)}
              </a>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {l.clicks} click{l.clicks === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
