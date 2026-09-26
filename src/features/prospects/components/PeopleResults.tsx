import { useState } from 'react'
import { BadgeCheck, Copy, ExternalLink, Loader2, Mail } from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { Badge } from '../../../components/ui/Badge'
import type { RevealResult } from '../../../server/prospecting/reveal'
import type { PersonResult, Seniority } from '../../../server/prospecting/types'
import { EmailStatusBadge } from './EmailStatusBadge'

export type RevealState = { status: 'loading' } | { status: 'error'; message: string } | RevealResult

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
  /** People whose title came from their profile rather than the search headline. */
  refined: Set<string>
  selected: Map<string, PersonResult>
  onToggle: (person: PersonResult) => void
  onToggleAll: (select: boolean) => void
  reveals: Map<string, RevealState>
  onReveal: (person: PersonResult) => void
  /** Saves `domain` as the person's company email domain, then retries. */
  onFixDomain: (person: PersonResult, domain: string) => Promise<void>
  /** Their company accepts every address, so no email there can be verified. */
  isCatchAll: (person: PersonResult) => boolean
  verifiedOnly: boolean
}

/** "Use a different domain" for a company whose LinkedIn website is wrong. */
function FixDomain({
  person,
  suggestion,
  onFixDomain,
}: {
  person: PersonResult
  /** From the company's DNS; one click to use it. */
  suggestion?: string
  onFixDomain: Props['onFixDomain']
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const apply = async (domain: string) => {
    setBusy(true)
    setError('')
    try {
      await onFixDomain(person, domain)
    } catch (err: any) {
      setError(err?.message ?? 'Could not save that domain')
      setBusy(false)
    }
  }
  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1">
        {suggestion && (
          <button
            type="button"
            disabled={busy}
            onClick={() => apply(suggestion)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md-xs text-[11px] font-semibold border border-accent/30 text-accent hover:bg-accent/10 whitespace-nowrap"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />} Try {suggestion}
          </button>
        )}
        <button type="button" onClick={() => setOpen(true)} className="text-[10px] font-semibold text-accent hover:underline">
          {suggestion ? 'Or use a different domain' : 'Use a different domain'}
        </button>
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    )
  }
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={async (e) => {
        e.preventDefault()
        const domain = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
          setError('Enter a domain like acme.com')
          return
        }
        await apply(domain)
      }}
    >
      <div className="flex gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. jaguarlandrover.com"
          className="w-40 px-2 py-1 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-accent outline-none"
        />
        <button type="submit" disabled={busy} className="text-xs font-semibold text-accent px-1">
          {busy ? '…' : 'Retry'}
        </button>
      </div>
      <span className="text-[10px] text-muted-foreground leading-snug max-w-[14rem]">
        Used for everyone at {person.company || 'this company'} from now on.
      </span>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </form>
  )
}

/** Reveal button, then the email and its verification status. */
function EmailCell({
  person,
  state,
  onReveal,
  onFixDomain,
  catchAll,
  verifiedOnly,
}: {
  person: PersonResult
  state?: RevealState
  onReveal: Props['onReveal']
  onFixDomain: Props['onFixDomain']
  catchAll: boolean
  verifiedOnly: boolean
}) {
  if (state?.status === 'loading') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Finding & verifying…
      </span>
    )
  }
  if (state?.status === 'found') {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-sm text-foreground break-all">{state.email}</span>
          <button
            type="button"
            title="Copy"
            onClick={() => navigator.clipboard?.writeText(state.email)}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <Copy className="w-3 h-3" />
          </button>
        </span>
        <EmailStatusBadge status={state.emailStatus} />
        {state.note && <span className="text-[10px] text-muted-foreground leading-snug max-w-[14rem]">{state.note}</span>}
      </div>
    )
  }
  // A definite answer (no address, no domain, unavailable) won't change on a
  // retry; only a failed request gets a "Try again".
  if (state && state.status !== 'error') {
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="text-[11px] text-muted-foreground leading-snug block max-w-[14rem]">{state.message}</span>
        {state.canFixDomain && (
          <FixDomain person={person} suggestion={'suggestedDomain' in state ? state.suggestedDomain : undefined} onFixDomain={onFixDomain} />
        )}
      </div>
    )
  }
  // Already a contact: the email is theirs from when they were saved.
  if (!state && person.previously === 'saved' && person.email) {
    const email = person.email
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-sm text-foreground break-all">{email}</span>
          <button
            type="button"
            title="Copy"
            onClick={() => navigator.clipboard?.writeText(email)}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <Copy className="w-3 h-3" />
          </button>
        </span>
        <span className="inline-flex items-center gap-1.5">
          {person.emailStatus && <EmailStatusBadge status={person.emailStatus} />}
          <span className="text-[10px] text-muted-foreground">Already in your contacts</span>
        </span>
      </div>
    )
  }
  // Nothing to reveal: the company accepts every address, and only verified
  // emails are handed over. (With verified-only off, Reveal still gives the
  // best guess, marked as catch-all.)
  if (catchAll && verifiedOnly) {
    return (
      <div className="flex flex-col items-start gap-1">
        <EmailStatusBadge status="catch_all_likely" />
        <span className="text-[10px] text-muted-foreground leading-snug max-w-[14rem]">
          Their company accepts every address, so no email can be verified.
        </span>
      </div>
    )
  }
  const failed = state ? state.message : null
  return (
    <div className="flex flex-col items-start gap-1">
      {catchAll && <EmailStatusBadge status="catch_all_likely" />}
      <button
        type="button"
        onClick={() => onReveal(person)}
        title={person.companyRef || person.companyDomain ? 'Find and verify their work email' : "We don't know where they work yet"}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md-xs text-[11px] font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors whitespace-nowrap"
      >
        <Mail className="w-3 h-3" /> {failed ? 'Try again' : 'Reveal email'}
      </button>
      {failed && <span className="text-[10px] text-muted-foreground leading-snug max-w-[12rem]">{failed}</span>}
      {!failed && person.previously === 'revealed' && <span className="text-[10px] text-muted-foreground">Revealed before</span>}
    </div>
  )
}

function TitleText({ person, refined }: { person: PersonResult; refined: boolean }) {
  return (
    <span className="inline-flex items-start gap-1">
      <span>{person.title || '—'}</span>
      {refined && (
        <span title="Exact title from their profile">
          <BadgeCheck className="w-3.5 h-3.5 text-accent shrink-0 mt-px" />
        </span>
      )}
    </span>
  )
}

export function PeopleResults({
  people,
  refined,
  selected,
  onToggle,
  onToggleAll,
  reveals,
  onReveal,
  onFixDomain,
  isCatchAll,
  verifiedOnly,
}: Props) {
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
              <p className="text-xs text-muted-foreground"><TitleText person={p} refined={refined.has(p.profileUrl)} /></p>
              <p className="text-xs text-foreground truncate mt-0.5">{p.company}{p.country ? ` · ${p.country}` : ''}</p>
              {p.seniority && <div className="mt-1.5"><Badge>{SENIORITY_LABEL[p.seniority]}</Badge></div>}
              <div className="mt-2"><EmailCell
                  person={p}
                  state={reveals.get(p.profileUrl)}
                  onReveal={onReveal}
                  onFixDomain={onFixDomain}
                  catchAll={isCatchAll(p)}
                  verifiedOnly={verifiedOnly}
                /></div>
            </div>
          </li>
        ))}
      </ul>

      <table className="hidden md:table w-full text-left border-collapse min-w-[820px]">
        <thead>
          <tr className="border-b border-border text-muted-foreground bg-card/20 sticky top-0 z-10 backdrop-blur-sm select-none">
            <th className="px-3 py-3 w-12 text-center">
              <input
                type="checkbox"
                aria-label="Select all on this page"
                className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                checked={allSelected}
                onChange={(e) => onToggleAll(e.target.checked)}
              />
            </th>
            <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider">Person</th>
            <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider">Job title</th>
            <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider">Seniority</th>
            <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider">Company</th>
            <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider">Country</th>
            <th className="px-3 py-3 text-[10px] font-bold uppercase tracking-wider">Email</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {people.map((p) => (
            <tr key={p.profileUrl} className="hover:bg-card/30 transition-colors">
              <td className="px-3 py-3 text-center">
                <input
                  type="checkbox"
                  className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                  checked={selected.has(p.profileUrl)}
                  onChange={() => onToggle(p)}
                />
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={`${p.firstName} ${p.lastName}`} />
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="font-semibold text-foreground text-sm">{p.firstName} {p.lastName}</p>
                    <a href={p.profileUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Profile">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 text-sm text-foreground max-w-xs">
                <TitleText person={p} refined={refined.has(p.profileUrl)} />
              </td>
              <td className="px-3 py-3">{p.seniority ? <Badge>{SENIORITY_LABEL[p.seniority]}</Badge> : <span className="text-xs text-muted-foreground">—</span>}</td>
              <td className="px-3 py-3 text-sm text-foreground">{p.company || '—'}</td>
              <td className="px-3 py-3 text-xs text-foreground">{p.country ?? '—'}</td>
              <td className="px-3 py-3">
                <EmailCell
                  person={p}
                  state={reveals.get(p.profileUrl)}
                  onReveal={onReveal}
                  onFixDomain={onFixDomain}
                  catchAll={isCatchAll(p)}
                  verifiedOnly={verifiedOnly}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
