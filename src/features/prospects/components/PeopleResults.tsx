import { ExternalLink } from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { Badge } from '../../../components/ui/Badge'
import type { PersonResult, Seniority } from '../../../server/prospecting/types'

export const SENIORITY_LABEL: Record<Seniority, string> = {
  owner: 'Owner',
  founder: 'Founder',
  c_suite: 'C-suite',
  partner: 'Partner',
  vp: 'VP',
  head: 'Head',
  director: 'Director',
  manager: 'Manager',
  senior: 'Senior',
  entry: 'Entry',
  intern: 'Intern',
}

interface Props {
  people: PersonResult[]
  selected: Map<string, PersonResult>
  onToggle: (person: PersonResult) => void
  onToggleAll: (select: boolean) => void
}

export function PeopleResults({ people, selected, onToggle, onToggleAll }: Props) {
  const allSelected = people.length > 0 && people.every((p) => selected.has(p.profileUrl))

  return (
    <>
      <ul className="md:hidden divide-y divide-border">
        {people.map((p) => (
          <li key={p.profileUrl} className="p-4 flex items-start gap-3">
            <label className="touch-target flex items-center justify-center shrink-0 -m-2 p-2">
              <input
                type="checkbox"
                className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                checked={selected.has(p.profileUrl)}
                onChange={() => onToggle(p)}
              />
            </label>
            <Avatar name={`${p.firstName} ${p.lastName}`} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground text-sm truncate">{p.firstName} {p.lastName}</p>
              <p className="text-xs text-muted-foreground truncate">{p.title || '—'}</p>
              <p className="text-xs text-foreground truncate mt-0.5">{p.company}{p.country ? ` · ${p.country}` : ''}</p>
              {p.seniority && <div className="mt-1.5"><Badge>{SENIORITY_LABEL[p.seniority]}</Badge></div>}
            </div>
          </li>
        ))}
      </ul>

      <table className="hidden md:table w-full text-left border-collapse min-w-[640px]">
        <thead>
          <tr className="border-b border-border text-muted-foreground bg-card/20 sticky top-0 z-10 backdrop-blur-sm select-none">
            <th className="px-6 py-3 w-12 text-center">
              <input
                type="checkbox"
                aria-label="Select all on this page"
                className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                checked={allSelected}
                onChange={(e) => onToggleAll(e.target.checked)}
              />
            </th>
            <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Person</th>
            <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Seniority</th>
            <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Company</th>
            <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Country</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {people.map((p) => (
            <tr key={p.profileUrl} className="hover:bg-card/30 transition-colors">
              <td className="px-6 py-3 text-center">
                <input
                  type="checkbox"
                  className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                  checked={selected.has(p.profileUrl)}
                  onChange={() => onToggle(p)}
                />
              </td>
              <td className="px-6 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={`${p.firstName} ${p.lastName}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-foreground text-sm leading-none">{p.firstName} {p.lastName}</p>
                      <a href={p.profileUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Profile">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate max-w-md">{p.title || '—'}</p>
                  </div>
                </div>
              </td>
              <td className="px-6 py-3">{p.seniority ? <Badge>{SENIORITY_LABEL[p.seniority]}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</td>
              <td className="px-6 py-3 text-sm text-foreground">{p.company || '—'}</td>
              <td className="px-6 py-3 text-xs text-foreground">{p.country ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
