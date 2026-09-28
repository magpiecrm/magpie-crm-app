import { ExternalLink } from 'lucide-react'
import { linkLabel, percent, type LinkActivity } from '../results'

/** Every tracked link in the campaign: how many people clicked it, and how often. */
export function LinkClicksTable({
  links,
  delivered,
  onShowPeople,
}: {
  links: LinkActivity[]
  delivered: number
  onShowPeople: (url: string) => void
}) {
  if (links.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl py-12 text-center text-sm text-muted-foreground">
        No link clicks yet.
      </div>
    )
  }
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-xs font-semibold text-muted-foreground text-left">
              <th className="px-4 py-3">Link</th>
              <th className="px-4 py-3 text-right">People</th>
              <th className="px-4 py-3 text-right">Clicks</th>
              <th className="px-4 py-3 text-right whitespace-nowrap">Of delivered</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {links.map((l) => (
              <tr key={l.url} className="hover:bg-muted/30">
                <td className="px-4 py-3 max-w-0 w-[55%]">
                  <a href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-foreground hover:text-accent" title={l.url}>
                    <span className="truncate">{linkLabel(l.url)}</span>
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                  </a>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{l.people}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{l.clicks}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{percent(l.people, delivered)}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => onShowPeople(l.url)} className="text-xs font-semibold text-accent hover:underline whitespace-nowrap">
                    Who clicked
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
