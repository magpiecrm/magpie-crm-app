import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Building2, ExternalLink, Globe } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'
import { setCompanyDomainFn } from '../../../server/functions'
import type { CompanyResult } from '../../../server/prospecting/types'

interface Props {
  companies: CompanyResult[]
  onFindPeople: (company: CompanyResult) => void
  onDomainSet: (ref: string, domain: string, catchAll?: boolean) => void
}

/** Inline "add domain" for companies SocialFetch has no website for. */
export function DomainCell({ company, onDomainSet }: { company: Pick<CompanyResult, 'ref' | 'name' | 'domain'>; onDomainSet: Props['onDomainSet'] }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const save = useMutation({
    mutationFn: () => setCompanyDomainFn({ data: { ref: company.ref, name: company.name, domain: value } }),
    onSuccess: (res) => {
      onDomainSet(res.ref, res.domain, res.catchAll)
      setEditing(false)
    },
  })

  if (company.domain) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-foreground">
        <Globe className="w-3 h-3 text-muted-foreground" />
        {company.domain}
      </span>
    )
  }
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="text-xs text-accent hover:underline font-semibold">
        Unknown, add domain
      </button>
    )
  }
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) save.mutate()
      }}
    >
      <div className="flex gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="acme.com"
          className="w-32 px-2 py-1 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-accent outline-none"
        />
        <button type="submit" disabled={save.isPending} className="text-xs font-semibold text-accent px-1.5">
          Save
        </button>
      </div>
      {save.isError && <span className="text-[10px] text-destructive">{(save.error as Error).message}</span>}
    </form>
  )
}

/** The company's mail server accepts every address, so no email there can be verified. */
function CatchAllBadge() {
  return (
    <span title="This company's mail server accepts every address, so no email there can be verified.">
      <Badge variant="warning">Can't verify emails</Badge>
    </span>
  )
}

function formatHeadcount(n: number | null) {
  if (n === null) return '—'
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString()
}

export function CompanyResults({ companies, onFindPeople, onDomainSet }: Props) {
  return (
    <>
      <ul className="md:hidden divide-y divide-border">
        {companies.map((c) => (
          <li key={c.ref} className="p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-md-s bg-muted flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-semibold text-foreground text-sm truncate">{c.name}</p>
              {c.catchAll && <CatchAllBadge />}
              <p className="text-xs text-muted-foreground truncate">
                {[c.industry, c.headcount !== null ? `${formatHeadcount(c.headcount)} staff` : null, c.country].filter(Boolean).join(' · ')}
              </p>
              <DomainCell company={c} onDomainSet={onDomainSet} />
            </div>
            <button
              type="button"
              onClick={() => onFindPeople(c)}
              className="shrink-0 text-xs font-semibold text-accent inline-flex items-center gap-1 py-1"
            >
              People <ArrowRight className="w-3 h-3" />
            </button>
          </li>
        ))}
      </ul>

      <table className="hidden md:table w-full text-left border-collapse min-w-[700px]">
        <thead>
          <tr className="border-b border-border text-muted-foreground bg-card/20 sticky top-0 z-10 backdrop-blur-sm select-none">
            <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Company</th>
            <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Domain</th>
            <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Industry</th>
            <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-right">Staff</th>
            <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Country</th>
            <th className="px-6 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {companies.map((c) => (
            <tr key={c.ref} className="hover:bg-card/30 transition-colors">
              <td className="px-6 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{c.name}</span>
                  {c.linkedinUrl && (
                    <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Company page">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                {c.companyType && <p className="text-[11px] text-muted-foreground">{c.companyType}</p>}
                {c.catchAll && <div className="mt-1"><CatchAllBadge /></div>}
              </td>
              <td className="px-6 py-3"><DomainCell company={c} onDomainSet={onDomainSet} /></td>
              <td className="px-6 py-3 text-xs text-foreground">{c.industry ?? '—'}</td>
              <td className="px-6 py-3 text-xs text-foreground text-right tabular-nums">{formatHeadcount(c.headcount)}</td>
              <td className="px-6 py-3 text-xs text-foreground">{c.country ?? '—'}</td>
              <td className="px-6 py-3 text-right">
                <button
                  type="button"
                  onClick={() => onFindPeople(c)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md-xs text-[11px] font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
                >
                  Find people <ArrowRight className="w-3 h-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
