import { useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  Briefcase,
  Building2,
  Factory,
  Globe,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  UserCheck,
  Users2,
  X,
} from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { TagInput } from '../../../components/ui/TagInput'
import { FilterAccordion } from '../../../components/ui/FilterAccordion'
import { Button } from '../../../components/ui/Button'
import { Sheet } from '../../../components/ui/Sheet'
import {
  getPersonasFn,
  prospectingStatusFn,
  resolveCompanyFn,
  revealEmailFn,
  searchCompaniesFn,
  searchPeopleFn,
  setCompanyDomainFn,
} from '../../../server/functions'
import {
  HEADCOUNT_BUCKETS,
  SENIORITY_LEVELS,
  type CompanyResult,
  type HeadcountBucket,
  type Page,
  type PersonResult,
  type Seniority,
} from '../../../server/prospecting/types'
import { parseSeniorityLabel } from '../../../server/prospecting/seniority'
import { SUPPORTED_COUNTRIES } from '../../../server/prospecting/geo'

import { INDUSTRIES } from '../constants/industries'
import { JOB_TITLES } from '../constants/jobTitles'
import type { Persona } from '../types'
import { CompanyPicker } from './CompanyPicker'
import { CompanyResults, DomainCell } from './CompanyResults'
import { PeopleResults, SENIORITY_LABEL, type RevealState } from './PeopleResults'
import { SaveProspectsDialog } from './SaveProspectsDialog'

type Mode = 'companies' | 'people'

interface CompanyForm {
  keyword: string
  industry: string
  headcount: HeadcountBucket[]
  country: string
}

interface ChosenCompany {
  ref: string
  name: string
  domain: string | null
}

interface PeopleForm {
  company: ChosenCompany | null
  titles: string[]
  seniorities: Seniority[]
  country: string
  keyword: string
  /** Results per page. Each result's profile is looked up, so this drives cost. */
  count: number
}

const PAGE_SIZES = [1, 5, 10, 25] as const

const EMPTY_COMPANY_FORM: CompanyForm = { keyword: '', industry: '', headcount: [], country: '' }
const EMPTY_PEOPLE_FORM: PeopleForm = { company: null, titles: [], seniorities: [], country: '', keyword: '', count: 5 }

/** Upper bound on one page: 3 credits per search (one per title) plus 3 per result's profile. */
function creditsPerPage(form: Pick<PeopleForm, 'titles' | 'count'>) {
  const searches = Math.max(1, Math.min(form.titles.length, 5))
  return searches * 3 + searches * form.count * 3
}

interface StoredState {
  mode: Mode
  companyForm: CompanyForm
  peopleForm: PeopleForm
  companySearch: CompanyForm | null
  peopleSearch: PeopleForm | null
}

const STORAGE_KEY = 'prospectSearch.v3'

function loadStoredState(): Partial<StoredState> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const inputClass =
  'w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-accent focus:border-transparent outline-none'

// Every search page costs SocialFetch credits, so results are never refetched
// behind the user's back — only an explicit Search or Load more spends.
const noRefetch = { staleTime: Infinity, gcTime: 30 * 60_000, refetchOnWindowFocus: false, retry: false } as const

const NO_REVEALS: Map<string, RevealState> = new Map()

export function ProspectSearch() {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('people')
  const [companyForm, setCompanyForm] = useState(EMPTY_COMPANY_FORM)
  const [peopleForm, setPeopleForm] = useState(EMPTY_PEOPLE_FORM)
  const [companySearch, setCompanySearch] = useState<CompanyForm | null>(null)
  const [peopleSearch, setPeopleSearch] = useState<PeopleForm | null>(null)
  const [restored, setRestored] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Map<string, PersonResult>>(new Map())
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  const [isSaveOpen, setIsSaveOpen] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ size: true, titles: true, seniority: true })
  const toggleSection = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  // Restored after mount, not during the first render: the server has no
  // sessionStorage, so reading it up front makes hydration fail.
  useEffect(() => {
    const stored = loadStoredState()
    if (stored) {
      if (stored.mode) setMode(stored.mode)
      if (stored.companyForm) setCompanyForm({ ...EMPTY_COMPANY_FORM, ...stored.companyForm })
      if (stored.peopleForm) setPeopleForm({ ...EMPTY_PEOPLE_FORM, ...stored.peopleForm })
      // Bring back results only while they're still cached (navigating within
      // the app). After a full reload that would mean re-running a paid search
      // unasked, so only the filters come back.
      if (stored.companySearch && queryClient.getQueryData(queryKeys.prospects.companies(stored.companySearch))) {
        setCompanySearch(stored.companySearch)
      }
      if (stored.peopleSearch && queryClient.getQueryData(queryKeys.prospects.people(stored.peopleSearch))) {
        setPeopleSearch(stored.peopleSearch)
      }
    }
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!restored) return
    try {
      const state: StoredState = { mode, companyForm, peopleForm, companySearch, peopleSearch }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // storage unavailable; state just won't survive navigation
    }
  }, [restored, mode, companyForm, peopleForm, companySearch, peopleSearch])

  const companies = useInfiniteQuery({
    queryKey: queryKeys.prospects.companies(companySearch),
    queryFn: ({ pageParam }) =>
      searchCompaniesFn({
        data: {
          keyword: companySearch!.keyword,
          industry: companySearch!.industry || undefined,
          headcount: companySearch!.headcount,
          country: companySearch!.country || undefined,
          cursor: pageParam,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: companySearch !== null,
    ...noRefetch,
  })

  const people = useInfiniteQuery({
    queryKey: queryKeys.prospects.people(peopleSearch),
    queryFn: ({ pageParam }) =>
      searchPeopleFn({
        data: {
          company: peopleSearch!.company ? { ref: peopleSearch!.company.ref, name: peopleSearch!.company.name } : null,
          titles: peopleSearch!.titles,
          seniorities: peopleSearch!.seniorities,
          country: peopleSearch!.country || undefined,
          keyword: peopleSearch!.keyword || undefined,
          count: peopleSearch!.count ?? EMPTY_PEOPLE_FORM.count,
          cursor: pageParam,
        },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: peopleSearch !== null,
    ...noRefetch,
  })

  const { data: personas = [] } = useQuery({
    queryKey: queryKeys.prospects.personas(),
    queryFn: () => getPersonasFn(),
  })

  const applyPersona = (persona: Persona) => {
    // Persona locations look like "London, United Kingdom"; only the country
    // can be filtered on.
    const country = persona.criteria.location?.[0]?.split(',').pop()?.trim() ?? ''
    setPeopleForm((f) => ({
      ...f,
      titles: persona.criteria.title ?? [],
      seniorities: (persona.criteria.seniority ?? []).map(parseSeniorityLabel).filter((s): s is Seniority => s !== null),
      country: country || f.country,
    }))
    setMode('people')
  }

  // Persona handed off from the Personas page ("Use in Prospect Search").
  useEffect(() => {
    const raw = sessionStorage.getItem('applyPersona')
    if (!raw) return
    sessionStorage.removeItem('applyPersona')
    try {
      applyPersona(JSON.parse(raw) as Persona)
    } catch {
      // ignore malformed payloads
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (mode === 'companies') {
      if (!companyForm.keyword.trim()) {
        setFormError('Enter a keyword. SocialFetch needs one to search companies.')
        return
      }
      setCompanySearch({ ...companyForm })
    } else {
      if (!peopleForm.company && peopleForm.titles.length === 0 && !peopleForm.keyword.trim()) {
        setFormError('Enter a job title or keyword, or pick a company.')
        return
      }
      // A different search starts with no revealed emails. Re-running the
      // same one shows the same (cached) people, so theirs stay.
      if (JSON.stringify(peopleForm) !== JSON.stringify(peopleSearch)) {
        queryClient.setQueryData(queryKeys.prospects.reveals(), new Map())
      }
      setPeopleSearch({ ...peopleForm })
    }
    setIsFiltersOpen(false)
  }

  const handleClear = () => {
    setFormError(null)
    if (mode === 'companies') setCompanyForm(EMPTY_COMPANY_FORM)
    else setPeopleForm(EMPTY_PEOPLE_FORM)
  }

  const findPeople = (c: Pick<CompanyResult, 'ref' | 'name' | 'domain'>) => {
    setPeopleForm((f) => ({ ...f, company: { ref: c.ref, name: c.name, domain: c.domain } }))
    setMode('people')
    setFormError(null)
    setExpanded((prev) => ({ ...prev, titles: true }))
  }

  // Keep the chosen company chip and the cached company rows in sync with a
  // domain the user entered or looked up.
  const applyDomain = (ref: string, domain: string | null) => {
    setPeopleForm((f) => (f.company?.ref === ref ? { ...f, company: { ...f.company, domain } } : f))
    setPeopleSearch((s) => (s?.company?.ref === ref ? { ...s, company: { ...s.company, domain } } : s))
    queryClient.setQueryData<InfiniteData<Page<CompanyResult>>>(queryKeys.prospects.companies(companySearch), (data) =>
      data && {
        ...data,
        pages: data.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.ref === ref ? { ...c, domain } : c)) })),
      },
    )
  }

  const lookupDomain = useMutation({
    mutationFn: (ref: string) => resolveCompanyFn({ data: { ref } }),
    onSuccess: (res) => applyDomain(res.ref, res.domain),
  })

  // Revealed emails are kept in memory next to the search results (the query
  // cache), so they survive moving around the app, and a reveal still running
  // when the user leaves lands anyway. A different search clears them, and
  // closing or reloading the tab loses them with the results. They're
  // personal data, so they're never written to storage, and only go into a
  // list if saved.
  const { data: reveals = NO_REVEALS } = useQuery({
    queryKey: queryKeys.prospects.reveals(),
    // Local state, not fetched: hand back whatever is already cached.
    queryFn: () => queryClient.getQueryData<Map<string, RevealState>>(queryKeys.prospects.reveals()) ?? new Map(),
    ...noRefetch,
  })
  const setReveal = (url: string, state: RevealState) =>
    queryClient.setQueryData<Map<string, RevealState>>(queryKeys.prospects.reveals(), (prev) => new Map(prev).set(url, state))
  const reveal = async (person: PersonResult) => {
    setReveal(person.profileUrl, { status: 'loading' })
    try {
      setReveal(person.profileUrl, await revealEmailFn({ data: { person } }))
    } catch (err: any) {
      setReveal(person.profileUrl, { status: 'error', message: err?.message ?? 'Something went wrong' })
    }
  }

  // Correct a company's email domain (its LinkedIn website was wrong or takes
  // no mail), then retry this person with it.
  const fixDomain = async (person: PersonResult, domain: string) => {
    if (!person.companyRef) return
    const res = await setCompanyDomainFn({ data: { ref: person.companyRef, name: person.company || person.companyRef, domain } })
    await reveal({ ...person, companyDomain: res.domain })
  }

  const togglePerson = (p: PersonResult) =>
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(p.profileUrl)) next.delete(p.profileUrl)
      else next.set(p.profileUrl, p)
      return next
    })

  const companyItems = companies.data?.pages.flatMap((p) => p.items) ?? []
  const allPeople = people.data?.pages.flatMap((p) => p.items) ?? []

  // People at companies that accept every address can't get a verified
  // email, so while verified-only is on they're hidden (with a count and a
  // way to show them). Shares the sidebar's status query.
  const { data: status } = useQuery({ queryKey: queryKeys.prospects.status(), queryFn: () => prospectingStatusFn() })
  const verifiedOnly = status?.verification?.verifiedOnly ?? true
  const [showCatchAll, setShowCatchAll] = useState(false)
  useEffect(() => setShowCatchAll(false), [peopleSearch])
  // A reveal can discover a catch-all company: mark everyone there now, and
  // later searches hide them (the finder cached it).
  const catchAllCompanies = new Set(
    allPeople.flatMap((p) => {
      const r = reveals.get(p.profileUrl)
      const found = (r?.status === 'unconfirmed' && r.catchAll) || (r?.status === 'found' && r.emailStatus === 'catch_all_likely')
      return found ? [p.companyRef ?? p.companyDomain ?? ''].filter(Boolean) : []
    }),
  )
  const isCatchAll = (p: PersonResult) =>
    Boolean(p.catchAll) || catchAllCompanies.has(p.companyRef ?? '') || catchAllCompanies.has(p.companyDomain ?? '')
  const catchAllCount = allPeople.filter((p) => p.catchAll).length
  const hidingCatchAll = verifiedOnly && !showCatchAll && catchAllCount > 0
  const peopleItems = hidingCatchAll ? allPeople.filter((p) => !p.catchAll) : allPeople
  // Titles checked against profiles, by the search itself or the button.
  // Results whose title and company came from their profile (✓ in the table).
  const refined = new Set(people.data?.pages.flatMap((p) => p.refined ?? []) ?? [])

  const toggleAllPeople = (select: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev)
      for (const p of peopleItems) {
        if (select) next.set(p.profileUrl, p)
        else next.delete(p.profileUrl)
      }
      return next
    })

  // A domain added after the search ran still applies to people found at
  // that company.
  const peopleToSave = [...selected.values()].map((p) => {
    // A revealed email is reused, so saving doesn't find and verify it again.
    const revealed = reveals.get(p.profileUrl)
    if (revealed?.status === 'found') return { ...p, email: revealed.email, emailStatus: revealed.emailStatus }
    const chosen = peopleSearch?.company
    if (p.companyDomain || !chosen?.domain) return p
    return p.companyRef === chosen.ref ? { ...p, companyDomain: chosen.domain } : p
  })

  const active = mode === 'companies' ? companies : people
  const lastPage = active.data?.pages[active.data.pages.length - 1]
  const warnings = lastPage?.warnings ?? []
  const reportedTotal = active.data?.pages[0]?.reportedTotal ?? null
  const shownCount = mode === 'companies' ? companyItems.length : peopleItems.length
  const hasSearched = mode === 'companies' ? companySearch !== null : peopleSearch !== null

  const activeFilterCount =
    mode === 'companies'
      ? [companyForm.keyword, companyForm.industry, companyForm.country].filter(Boolean).length + (companyForm.headcount.length ? 1 : 0)
      : [peopleForm.company, peopleForm.country, peopleForm.keyword].filter(Boolean).length +
        (peopleForm.titles.length ? 1 : 0) +
        (peopleForm.seniorities.length ? 1 : 0)

  const companyFilters = (
    <div className="flex flex-col gap-3 py-2">
      <div>
        <label className="block text-[11px] font-semibold text-foreground mb-1">Keyword</label>
        <input
          className={inputClass}
          value={companyForm.keyword}
          placeholder="e.g. payments, logistics software, Acme"
          onChange={(e) => setCompanyForm({ ...companyForm, keyword: e.target.value })}
        />
        <p className="text-[10px] text-muted-foreground mt-1 leading-snug">Required. Matches company names and descriptions.</p>
      </div>

      <FilterAccordion label="Industry" icon={<Factory className="w-4 h-4" />} isOpen={!!expanded.industry} onToggle={() => toggleSection('industry')} badgeCount={companyForm.industry ? 1 : 0}>
        <input
          className={inputClass}
          list="prospect-industries"
          value={companyForm.industry}
          placeholder="e.g. Software Development"
          onChange={(e) => setCompanyForm({ ...companyForm, industry: e.target.value })}
        />
        <datalist id="prospect-industries">
          {INDUSTRIES.map((i) => <option key={i} value={i} />)}
        </datalist>
      </FilterAccordion>

      <FilterAccordion label="Company size" icon={<Users2 className="w-4 h-4" />} isOpen={!!expanded.size} onToggle={() => toggleSection('size')} badgeCount={companyForm.headcount.length}>
        <div className="grid grid-cols-2 gap-1">
          {HEADCOUNT_BUCKETS.map((b) => (
            <label key={b} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border text-accent focus:ring-accent"
                checked={companyForm.headcount.includes(b)}
                onChange={(e) =>
                  setCompanyForm({
                    ...companyForm,
                    headcount: e.target.checked ? [...companyForm.headcount, b] : companyForm.headcount.filter((x) => x !== b),
                  })
                }
              />
              {b}
            </label>
          ))}
        </div>
      </FilterAccordion>

      <FilterAccordion label="HQ country" icon={<Globe className="w-4 h-4" />} isOpen={!!expanded.hq} onToggle={() => toggleSection('hq')} badgeCount={companyForm.country ? 1 : 0}>
        <input className={inputClass} value={companyForm.country} placeholder="e.g. United Kingdom" onChange={(e) => setCompanyForm({ ...companyForm, country: e.target.value })} />
      </FilterAccordion>

      <p className="text-[10px] text-muted-foreground leading-snug px-1">
        Industry, size and country filter each page of results after it comes back, so a narrow filter can
        leave a page short. Use Load more.
      </p>
    </div>
  )

  const peopleFilters = (
    <div className="flex flex-col gap-3 py-2">
      <div>
        <label className="block text-[11px] font-semibold text-foreground mb-1">Company</label>
        {peopleForm.company ? (
          <div className="border border-border rounded-md-s p-2 bg-background space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-foreground truncate flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                {peopleForm.company.name}
              </span>
              <button type="button" aria-label="Remove company" onClick={() => setPeopleForm({ ...peopleForm, company: null })} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <DomainCell company={peopleForm.company} onDomainSet={applyDomain} />
            {!peopleForm.company.domain && (
              <button
                type="button"
                disabled={lookupDomain.isPending}
                onClick={() => lookupDomain.mutate(peopleForm.company!.ref)}
                className="block text-[10px] text-muted-foreground hover:text-foreground underline"
              >
                {lookupDomain.isPending ? 'Looking up…' : 'Or look it up on the company page (1–9 credits)'}
              </button>
            )}
            {lookupDomain.isSuccess && !lookupDomain.data.domain && lookupDomain.data.ref === peopleForm.company.ref && (
              <p className="text-[10px] text-muted-foreground">The company page lists no website. Add the domain by hand to find emails.</p>
            )}
          </div>
        ) : (
          <CompanyPicker onPick={(c) => setPeopleForm({ ...peopleForm, company: { ref: c.ref, name: c.name, domain: c.domain } })} />
        )}
      </div>

      <FilterAccordion label="Job titles" icon={<Briefcase className="w-4 h-4" />} isOpen={!!expanded.titles} onToggle={() => toggleSection('titles')} badgeCount={peopleForm.titles.length}>
        <TagInput label="Job titles" tags={peopleForm.titles} placeholder="e.g. Head of Marketing" onChange={(titles) => setPeopleForm({ ...peopleForm, titles })} suggestions={JOB_TITLES} />
        <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">Up to 5. Each title is a separate search (3 credits per page).</p>
      </FilterAccordion>

      <FilterAccordion label="Seniority" icon={<UserCheck className="w-4 h-4" />} isOpen={!!expanded.seniority} onToggle={() => toggleSection('seniority')} badgeCount={peopleForm.seniorities.length}>
        <div className="grid grid-cols-2 gap-1">
          {SENIORITY_LEVELS.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border text-accent focus:ring-accent"
                checked={peopleForm.seniorities.includes(s)}
                onChange={(e) =>
                  setPeopleForm({
                    ...peopleForm,
                    seniorities: e.target.checked ? [...peopleForm.seniorities, s] : peopleForm.seniorities.filter((x) => x !== s),
                  })
                }
              />
              {SENIORITY_LABEL[s]}
            </label>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">Worked out from each person's title.</p>
      </FilterAccordion>

      <FilterAccordion label="Country" icon={<Globe className="w-4 h-4" />} isOpen={!!expanded.country} onToggle={() => toggleSection('country')} badgeCount={peopleForm.country ? 1 : 0}>
        <input
          className={inputClass}
          list="prospect-countries"
          value={peopleForm.country}
          placeholder="e.g. United Kingdom"
          onChange={(e) => setPeopleForm({ ...peopleForm, country: e.target.value })}
        />
        <datalist id="prospect-countries">
          {SUPPORTED_COUNTRIES.map((c) => <option key={c} value={c} />)}
        </datalist>
        <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
          Countries in the list are filtered by SocialFetch. Others are filtered after each page, so pages can be thin.
        </p>
      </FilterAccordion>

      <FilterAccordion label="Keyword" icon={<Search className="w-4 h-4" />} isOpen={!!expanded.keyword} onToggle={() => toggleSection('keyword')} badgeCount={peopleForm.keyword ? 1 : 0}>
        <input className={inputClass} value={peopleForm.keyword} placeholder="e.g. fintech" onChange={(e) => setPeopleForm({ ...peopleForm, keyword: e.target.value })} />
      </FilterAccordion>

      {(personas as Persona[]).length > 0 && (
        <FilterAccordion label="Apply persona" icon={<UserCheck className="w-4 h-4" />} isOpen={!!expanded.personas} onToggle={() => toggleSection('personas')}>
          <select
            className={inputClass}
            value=""
            onChange={(e) => {
              const persona = (personas as Persona[]).find((p) => p.id === e.target.value)
              if (persona) applyPersona(persona)
            }}
          >
            <option value="">Choose a persona…</option>
            {(personas as Persona[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">Fills titles, seniority and country.</p>
        </FilterAccordion>
      )}
    </div>
  )

  const filtersHeader = (
    <div className="p-4 border-b border-border flex items-center justify-between bg-card/50">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
        {mode === 'companies' ? 'Company filters' : 'People filters'}
      </h3>
      <button type="button" onClick={handleClear} className="text-[10px] text-accent hover:underline font-semibold">
        Clear
      </button>
    </div>
  )

  const filtersFooter = (
    <div className="p-4 border-t border-border bg-card/50 flex flex-col gap-2">
      {formError && <p className="text-[11px] text-destructive font-medium">{formError}</p>}
      {mode === 'people' && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="people-page-size" className="text-[11px] font-semibold text-foreground">
            Results per page
          </label>
          <select
            id="people-page-size"
            value={peopleForm.count}
            onChange={(e) => setPeopleForm({ ...peopleForm, count: Number(e.target.value) })}
            className="px-2 py-1 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-accent outline-none"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}
      {mode === 'people' && (
        <p className="text-[10px] text-muted-foreground leading-snug">
          Up to <span className="font-semibold text-foreground">{creditsPerPage(peopleForm)} credits</span> per page: 3 for the
          search plus 3 per result, since each profile is checked for their current job and company.
        </p>
      )}
      <button
        type="submit"
        className="w-full bg-primary text-primary-foreground py-2 rounded-md-s text-xs font-semibold hover:bg-primary/85 active:scale-95 transition-all flex items-center justify-center gap-2"
      >
        <Search className="w-3.5 h-3.5" />
        {mode === 'companies' ? 'Search companies' : 'Search people'}
      </button>
    </div>
  )

  const filtersBody = mode === 'companies' ? companyFilters : peopleFilters

  const renderEmpty = (message: string) => (
    <div className="px-6 py-16 text-center text-muted-foreground text-xs font-medium">{message}</div>
  )

  return (
    <div className="flex w-full h-full overflow-hidden bg-background">
      <form onSubmit={handleSearch} className="hidden lg:flex w-72 shrink-0 border-r border-border bg-card flex-col h-full overflow-hidden select-none">
        {filtersHeader}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-2">{filtersBody}</div>
        {filtersFooter}
      </form>

      <Sheet
        isOpen={isFiltersOpen}
        onClose={() => setIsFiltersOpen(false)}
        title={<h3 className="text-base font-bold text-foreground">{mode === 'companies' ? 'Company filters' : 'People filters'}</h3>}
        className="lg:hidden"
        footer={<form onSubmit={handleSearch}>{filtersFooter}</form>}
      >
        <div className="px-4 py-2">{filtersBody}</div>
      </Sheet>

      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-border bg-card flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-foreground font-display leading-tight">Prospect Search</h1>
            <p className="hidden sm:block text-xs text-muted-foreground mt-0.5">
              Find people by job title, seniority and country. Emails are looked up only when you save someone to a list.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsFiltersOpen(true)}
              className="lg:hidden text-xs border border-border bg-card px-3 py-2 rounded-md-s font-semibold flex items-center gap-1.5 hover:bg-muted transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              {activeFilterCount > 0 && <span className="bg-accent text-accent-foreground rounded-full px-1.5 text-[10px] font-bold">{activeFilterCount}</span>}
            </button>
            {selected.size > 0 && (
              <Button size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />} onClick={() => setIsSaveOpen(true)}>
                Save {selected.size} to list
              </Button>
            )}
          </div>
        </div>

        <div className="px-4 sm:px-6 border-b border-border flex items-center justify-between gap-3 bg-card/10 shrink-0">
          <div role="tablist" className="flex gap-4">
            {(['people', 'companies'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                type="button"
                onClick={() => {
                  setMode(m)
                  setFormError(null)
                }}
                className={`py-2.5 text-xs font-semibold border-b-2 transition-colors ${mode === m ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              >
                {m === 'companies' ? 'Browse companies' : 'People'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground font-medium">
            {hasSearched && !active.isLoading && !active.error && (
              <span>
                {shownCount} shown{reportedTotal ? ` · ~${reportedTotal.toLocaleString()} reported` : ''}
              </span>
            )}
            {selected.size > 0 && (
              <button type="button" className="hover:text-foreground underline" onClick={() => setSelected(new Map())}>
                Clear {selected.size} selected
              </button>
            )}
          </div>
        </div>

        {mode === 'people' && verifiedOnly && catchAllCount > 0 && (
          <div className="px-6 py-2 border-b border-border bg-muted/40 shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              {hidingCatchAll
                ? `${catchAllCount} ${catchAllCount === 1 ? 'person works at a company' : 'people work at companies'} that accept every address, so no email there can be verified. Hidden for now.`
                : `Showing ${catchAllCount} ${catchAllCount === 1 ? 'person' : 'people'} at companies that accept every address; their emails can't be verified.`}
            </span>
            <button type="button" onClick={() => setShowCatchAll((v) => !v)} className="font-semibold text-accent hover:underline">
              {hidingCatchAll ? 'Show them' : 'Hide them'}
            </button>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="px-6 py-2 border-b border-border bg-amber-500/10 shrink-0 flex flex-col gap-1">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-amber-600 dark:text-amber-500">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="text-[10px] leading-snug font-medium">{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-auto custom-scrollbar bg-background">
          {active.error ? (
            <div className="px-6 py-16 flex flex-col items-center gap-2 text-destructive text-center">
              <AlertCircle className="w-6 h-6" />
              <span className="text-xs font-semibold max-w-md">{(active.error as Error).message}</span>
              {/Settings → Prospecting/.test((active.error as Error).message) && (
                <Link
                  to="/settings"
                  search={{ tab: 'prospecting' }}
                  className="mt-2 text-xs font-semibold text-accent hover:underline"
                >
                  Open prospecting settings
                </Link>
              )}
            </div>
          ) : !hasSearched ? (
            renderEmpty(
              mode === 'companies'
                ? 'Search for companies by keyword, then open one to find people there.'
                : 'Search for people by job title, seniority or keyword. Add a company to search inside just one.',
            )
          ) : active.isLoading ? (
            <div className="px-6 py-16 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : shownCount === 0 ? (
            renderEmpty(
              mode === 'people' && hidingCatchAll
                ? 'Everyone found so far works at a company that accepts every address. Show them, or load more to keep looking.'
                : active.hasNextPage
                  ? 'Nothing on this page matched your filters. Load more to keep looking.'
                  : 'No results. Try a broader keyword or fewer filters.',
            )
          ) : mode === 'companies' ? (
            <CompanyResults companies={companyItems} onFindPeople={findPeople} onDomainSet={applyDomain} />
          ) : (
            <PeopleResults
              people={peopleItems}
              refined={refined}
              selected={selected}
              onToggle={togglePerson}
              onToggleAll={toggleAllPeople}
              reveals={reveals}
              onReveal={reveal}
              onFixDomain={fixDomain}
              isCatchAll={isCatchAll}
              verifiedOnly={verifiedOnly}
            />
          )}

          {hasSearched && active.hasNextPage && !active.error && (
            <div className="p-4 flex justify-center">
              <Button variant="outline" size="sm" isLoading={active.isFetchingNextPage} onClick={() => active.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
        </div>
      </div>

      <SaveProspectsDialog
        isOpen={isSaveOpen}
        people={peopleToSave}
        onClose={(saved) => {
          setIsSaveOpen(false)
          if (saved) setSelected(new Map())
        }}
      />
    </div>
  )
}
