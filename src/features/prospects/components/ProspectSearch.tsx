import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import {
  Search,
  Plus,
  Users2,
  Mail,
  Briefcase,
  UserCheck,
  MapPin,
  Building2,
  Building,
  Factory,
  Globe,
  AlertCircle,
  Loader2,
  SlidersHorizontal
} from 'lucide-react'
import { Avatar } from '../../../components/ui/Avatar'
import { Badge } from '../../../components/ui/Badge'
import { TagInput } from '../../../components/ui/TagInput'
import { FilterAccordion } from '../../../components/ui/FilterAccordion'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Sheet } from '../../../components/ui/Sheet'
import { lushaSearchFn, getPersonasFn, listsFn, addContactsFn, createListFn, revealEmailFn } from '../../../server/functions'
import { INDUSTRIES } from '../constants/industries'
import { LOCATIONS } from '../constants/locations'
import { JOB_TITLES } from '../constants/jobTitles'
import type { Persona } from '../types'

// Generect's closed seniority vocabulary; anything else is silently ignored.
const SENIORITIES = ['owner', 'founder', 'c_suite', 'partner', 'vp', 'head', 'director', 'manager', 'senior', 'entry', 'intern']

export interface Contact {
  id: string
  firstName: string
  lastName: string
  title: string
  company: string
  emailAddresses: { email: string }[]
  phoneNumbers: { number: string }[]
  linkedinUrl?: string
}

interface ProspectSearchProps {
  onSelectionChange: (selectedIds: Set<string>, contacts: Contact[]) => void
  selectedIds: Set<string>
}

// Every filter here is sent to Generect and provably affects results. Anything
// Generect's search API doesn't support is deliberately absent rather than
// rendered as a control that silently does nothing.
const defaultFilters = {
  // Leads
  title: [] as string[],
  personas: [] as string[],
  seniority: [] as string[],
  excludedTitles: [] as string[],
  leadsLocation: [] as string[],
  location: [] as string[], // persona-fed only; merges into `locations`
  excludeLocations: [] as string[],
  // Companies
  company: [] as string[],
  companyLocation: [] as string[],
  industry: [] as string[],
  excludeIndustries: [] as string[],
  employeeCount: [] as string[],
  excludeHeadcounts: [] as string[],
  companyTypes: [] as string[],
  requireWebsite: true,
  // Meta
  limit: 20,
}

const HEADCOUNT_OPTIONS = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10 000+']
const COMPANY_TYPES = ['Public Company', 'Privately Held', 'Non Profit', 'Government Agency', 'Educational', 'Partnership', 'Self Employed', 'Sole Proprietorship']

const FILTERS_STORAGE_KEY = 'prospectSearch.filters'
const HAS_SEARCHED_STORAGE_KEY = 'prospectSearch.hasSearched'

function loadStoredFilters(): typeof defaultFilters {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY)
    return raw ? { ...defaultFilters, ...JSON.parse(raw) } : defaultFilters
  } catch {
    return defaultFilters
  }
}

export function ProspectSearch({ onSelectionChange, selectedIds }: ProspectSearchProps) {
  const queryClient = useQueryClient()
  const [isAddToListOpen, setIsAddToListOpen] = useState(false)
  const [isFiltersOpen, setIsFiltersOpen] = useState(false)
  const [targetListId, setTargetListId] = useState<number | ''>('')
  const [isCreatingList, setIsCreatingList] = useState(false)
  const [newListName, setNewListName] = useState('')

  const { data: listsData } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
    enabled: isAddToListOpen,
  })
  const lists = listsData?.lists || []

  const createListMutation = useMutation({
    mutationFn: (name: string) => createListFn({ data: { name } }),
    onSuccess: (newList) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      setTargetListId(newList.id)
      setIsCreatingList(false)
      setNewListName('')
    },
  })

  const addToListMutation = useMutation({
    mutationFn: (data: { listId: number; contacts: any[] }) => addContactsFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.contacts() })
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      closeAddToListDialog()
      onSelectionChange(new Set(), contacts)
    },
  })

  const closeAddToListDialog = () => {
    setIsAddToListOpen(false)
    setTargetListId('')
    setIsCreatingList(false)
    setNewListName('')
  }

  const [filters, setFilters] = useState(loadStoredFilters)
  const [hasSearched, setHasSearched] = useState(
    () => sessionStorage.getItem(HAS_SEARCHED_STORAGE_KEY) === 'true'
  )

  useEffect(() => {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters))
  }, [filters])

  // Track expanded state for accordion sidebar filters
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'job-title': true,
    'company-name': true
  })

  const { data: savedPersonas = [] } = useQuery({
    queryKey: queryKeys.prospects.personas(),
    queryFn: () => getPersonasFn(),
  })

  const applyPersona = (persona: Persona) => {
    setFilters(f => ({
      ...f,
      title: persona.criteria.title,
      industry: persona.criteria.industry,
      location: persona.criteria.location,
      employeeCount: persona.criteria.employeeCount ? [persona.criteria.employeeCount] : [],
      // persona.criteria.keywords is intentionally not applied — Generect's
      // database search rejects keyword filtering; it's messaging context only.
      seniority: persona.criteria.seniority ?? [],
      excludedTitles: persona.criteria.excludedTitles ?? [],
      personas: persona.name && !f.personas.includes(persona.name) ? [...f.personas, persona.name] : f.personas,
    }))
    setExpandedSections(prev => ({ ...prev, 'job-title': true, 'company-name': true, personas: true }))
  }

  // Pick up a persona handed off from the Personas page ("Use in Prospect Search")
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

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  const { data, isLoading, refetch, error } = useQuery({
    queryKey: queryKeys.prospects.search(filters),
    queryFn: () => lushaSearchFn({
      data: {
        title: filters.title,
        company: filters.company,
        industry: filters.industry,
        location: filters.location,
        leadsLocation: filters.leadsLocation,
        companyLocation: filters.companyLocation,
        employeeCount: filters.employeeCount,
        seniority: filters.seniority,
        excludedTitles: filters.excludedTitles,
        limit: filters.limit,
        personas: filters.personas,
        excludeLocations: filters.excludeLocations,
        excludeIndustries: filters.excludeIndustries,
        excludeHeadcounts: filters.excludeHeadcounts,
        companyTypes: filters.companyTypes,
        requireWebsite: filters.requireWebsite,
      }
    }),
    enabled: false,
  })

  // Restore results after remount (e.g. navigating away and back) if a
  // search was already run in this session — but never auto-search on
  // filter changes; that still requires an explicit Search click.
  useEffect(() => {
    if (hasSearched) refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setHasSearched(true)
    setIsFiltersOpen(false)
    sessionStorage.setItem(HAS_SEARCHED_STORAGE_KEY, 'true')
    refetch()
  }

  // Only array filters count — `requireWebsite` and `limit` always have a value.
  const activeFilterCount = Object.entries(filters).filter(
    ([, value]) => Array.isArray(value) && value.length > 0
  ).length

  const handleClearAll = () => {
    setFilters(defaultFilters)
    setHasSearched(false)
    sessionStorage.removeItem(FILTERS_STORAGE_KEY)
    sessionStorage.removeItem(HAS_SEARCHED_STORAGE_KEY)
  }

  const contacts: Contact[] = data?.contacts || []
  // Generect reports how many leads match in total, which is almost always far
  // more than `limit` returns — without this the user can't tell a narrow ICP
  // from a limit they should raise.
  const totalMatches: number = data?.totalMatches || 0
  const warnings: string[] = data?.warnings || []

  // Each reveal is a paid Generect lookup, so it's per-contact and explicit.
  const [revealingIds, setRevealingIds] = useState<Set<string>>(new Set())
  const [noEmailIds, setNoEmailIds] = useState<Set<string>>(new Set())

  const revealEmail = async (contact: Contact) => {
    if (!contact.linkedinUrl || revealingIds.has(contact.id)) return
    setRevealingIds(prev => new Set(prev).add(contact.id))
    try {
      const { email } = await revealEmailFn({ data: { linkedinUrl: contact.linkedinUrl } })
      if (email) {
        queryClient.setQueryData(
          queryKeys.prospects.search(filters),
          (prev: any) => prev && {
            ...prev,
            contacts: prev.contacts.map((c: Contact) =>
              c.id === contact.id ? { ...c, emailAddresses: [{ email }] } : c
            ),
          }
        )
      } else {
        setNoEmailIds(prev => new Set(prev).add(contact.id))
      }
    } finally {
      setRevealingIds(prev => {
        const next = new Set(prev)
        next.delete(contact.id)
        return next
      })
    }
  }

  const toggleSelection = (id: string) => {
    const newSelection = new Set(selectedIds)
    if (newSelection.has(id)) {
      newSelection.delete(id)
    } else {
      newSelection.add(id)
    }
    onSelectionChange(newSelection, contacts)
  }

  // Extracted so the same filter controls can render as a desktop rail and as a
  // mobile bottom sheet without duplicating ~350 lines of accordion markup.
  const filtersHeader = (
    <>
        {/* Sidebar Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-card/50">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Filters
          </h3>
          <button
            type="button"
            onClick={handleClearAll}
            className="text-[10px] text-accent hover:underline font-semibold"
          >
            Clear All
          </button>
        </div>
    </>
  )

  const filtersBody = (
    <>
          {/* Leads Filters Group */}
          <div className="flex flex-col mb-2">
            <div className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-1 mt-2 px-1">
              Leads filters
            </div>

            <FilterAccordion
              label="Job Title"
              icon={<Briefcase className="w-4 h-4" />}
              isOpen={!!expandedSections['job-title']}
              onToggle={() => toggleSection('job-title')}
              badgeCount={filters.title.length}
            >
              <TagInput
                label="Job Title"
                tags={filters.title}
                placeholder="e.g. CEO, Founder, VP"
                onChange={(val) => setFilters({ ...filters, title: val })}
                suggestions={JOB_TITLES}
              />
              <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
                Suggestions are shortcuts &mdash; any title works here.
              </p>
            </FilterAccordion>

            <FilterAccordion
              label="Personas"
              icon={<UserCheck className="w-4 h-4" />}
              isOpen={!!expandedSections['personas']}
              onToggle={() => toggleSection('personas')}
              badgeCount={filters.personas.length}
            >
              <select
                className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-accent focus:border-transparent outline-none"
                value={filters.personas.length > 0 ? filters.personas[0] : ''}
                onChange={(e) => {
                  const val = e.target.value
                  setFilters({ ...filters, personas: val ? [val] : [] })
                }}
              >
                <option value="">Any Persona</option>
                {(savedPersonas as Persona[]).map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FilterAccordion>

            <FilterAccordion
              label="Seniority"
              icon={<UserCheck className="w-4 h-4" />}
              isOpen={!!expandedSections['seniority']}
              onToggle={() => toggleSection('seniority')}
              badgeCount={filters.seniority.length}
            >
              <TagInput
                label="Seniority"
                tags={filters.seniority}
                placeholder="e.g. c_suite, founder, vp"
                onChange={(val) => setFilters({ ...filters, seniority: val })}
                suggestions={SENIORITIES}
              />
              <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
                Values outside the suggested list are ignored by Generect.
              </p>
            </FilterAccordion>

            <FilterAccordion
              label="Excluded Titles"
              icon={<Briefcase className="w-4 h-4" />}
              isOpen={!!expandedSections['excluded-titles']}
              onToggle={() => toggleSection('excluded-titles')}
              badgeCount={filters.excludedTitles.length}
            >
              <TagInput
                label="Excluded Titles"
                tags={filters.excludedTitles}
                placeholder="e.g. Assistant, Intern"
                onChange={(val) => setFilters({ ...filters, excludedTitles: val })}
                suggestions={JOB_TITLES}
              />
            </FilterAccordion>

            <FilterAccordion
              label="Location"
              icon={<MapPin className="w-4 h-4" />}
              isOpen={!!expandedSections['leads-location']}
              onToggle={() => toggleSection('leads-location')}
              badgeCount={filters.leadsLocation.length}
            >
              <TagInput
                label="Leads Location"
                tags={filters.leadsLocation}
                placeholder="e.g. United States"
                onChange={(val) => setFilters({ ...filters, leadsLocation: val })}
                suggestions={LOCATIONS}
              />
              <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
                Pick from suggestions. Regions must be qualified &mdash; &ldquo;California, United States&rdquo;, not &ldquo;California&rdquo;.
              </p>
            </FilterAccordion>

            <FilterAccordion
              label="Excluded Locations"
              icon={<MapPin className="w-4 h-4" />}
              isOpen={!!expandedSections['exclude-locations']}
              onToggle={() => toggleSection('exclude-locations')}
              badgeCount={filters.excludeLocations.length}
            >
              <TagInput
                label="Excluded Locations"
                tags={filters.excludeLocations}
                placeholder="e.g. India"
                onChange={(val) => setFilters({ ...filters, excludeLocations: val })}
                suggestions={LOCATIONS}
              />
            </FilterAccordion>
          </div>

          {/* Companies Filters Group */}
          <div className="flex flex-col mb-2">
            <div className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-1 mt-2 px-1">
              Companies filters
            </div>

            <FilterAccordion
              label="Company name"
              icon={<Building className="w-4 h-4" />}
              isOpen={!!expandedSections['company-name']}
              onToggle={() => toggleSection('company-name')}
              badgeCount={filters.company.length}
            >
              <TagInput
                label="Company"
                tags={filters.company}
                placeholder="e.g. Google, Stripe"
                onChange={(val) => setFilters({ ...filters, company: val })}
              />
              {filters.company.length > 1 && (
                <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
                  Each company is searched separately and the results combined &mdash; {filters.company.length} searches.
                </p>
              )}
            </FilterAccordion>

            <FilterAccordion
              label="Location"
              icon={<MapPin className="w-4 h-4" />}
              isOpen={!!expandedSections['company-location']}
              onToggle={() => toggleSection('company-location')}
              badgeCount={filters.companyLocation.length}
            >
              <TagInput
                label="Company Location"
                tags={filters.companyLocation}
                placeholder="e.g. United States"
                onChange={(val) => setFilters({ ...filters, companyLocation: val })}
                suggestions={LOCATIONS}
              />
            </FilterAccordion>

            <FilterAccordion
              label="Industry"
              icon={<Factory className="w-4 h-4" />}
              isOpen={!!expandedSections['industry']}
              onToggle={() => toggleSection('industry')}
              badgeCount={filters.industry.length}
            >
              <TagInput
                label="Industry"
                tags={filters.industry}
                placeholder="e.g. Software Development"
                onChange={(val) => setFilters({ ...filters, industry: val })}
                suggestions={INDUSTRIES}
              />
              <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
                Pick from suggestions &mdash; unrecognised industries silently match nothing.
              </p>
            </FilterAccordion>

            <FilterAccordion
              label="Excluded Industries"
              icon={<Factory className="w-4 h-4" />}
              isOpen={!!expandedSections['exclude-industries']}
              onToggle={() => toggleSection('exclude-industries')}
              badgeCount={filters.excludeIndustries.length}
            >
              <TagInput
                label="Excluded Industries"
                tags={filters.excludeIndustries}
                placeholder="e.g. Banking"
                onChange={(val) => setFilters({ ...filters, excludeIndustries: val })}
                suggestions={INDUSTRIES}
              />
            </FilterAccordion>

            <FilterAccordion
              label="Headcount"
              icon={<Users2 className="w-4 h-4" />}
              isOpen={!!expandedSections['headcount']}
              onToggle={() => toggleSection('headcount')}
              badgeCount={filters.employeeCount.length}
            >
              <div className="flex flex-wrap gap-1.5">
                {HEADCOUNT_OPTIONS.map((h) => {
                  const active = filters.employeeCount.includes(h)
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setFilters({
                        ...filters,
                        employeeCount: active
                          ? filters.employeeCount.filter((x) => x !== h)
                          : [...filters.employeeCount, h],
                      })}
                      className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                        active
                          ? 'bg-accent text-accent-foreground border-accent'
                          : 'bg-background text-muted-foreground border-border hover:border-accent/50'
                      }`}
                    >
                      {h}
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
                Leave all unselected to match any size.
              </p>
            </FilterAccordion>

            <FilterAccordion
              label="Excluded Headcounts"
              icon={<Users2 className="w-4 h-4" />}
              isOpen={!!expandedSections['exclude-headcount']}
              onToggle={() => toggleSection('exclude-headcount')}
              badgeCount={filters.excludeHeadcounts.length}
            >
              <div className="flex flex-wrap gap-1.5">
                {HEADCOUNT_OPTIONS.map((h) => {
                  const active = filters.excludeHeadcounts.includes(h)
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setFilters({
                        ...filters,
                        excludeHeadcounts: active
                          ? filters.excludeHeadcounts.filter((x) => x !== h)
                          : [...filters.excludeHeadcounts, h],
                      })}
                      className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                        active
                          ? 'bg-accent text-accent-foreground border-accent'
                          : 'bg-background text-muted-foreground border-border hover:border-accent/50'
                      }`}
                    >
                      {h}
                    </button>
                  )
                })}
              </div>
            </FilterAccordion>

            <FilterAccordion
              label="Company type"
              icon={<Building2 className="w-4 h-4" />}
              isOpen={!!expandedSections['company-type']}
              onToggle={() => toggleSection('company-type')}
              badgeCount={filters.companyTypes.length}
            >
              <div className="flex flex-wrap gap-1.5">
                {COMPANY_TYPES.map((t) => {
                  const active = filters.companyTypes.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFilters({
                        ...filters,
                        companyTypes: active
                          ? filters.companyTypes.filter((x) => x !== t)
                          : [...filters.companyTypes, t],
                      })}
                      className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                        active
                          ? 'bg-accent text-accent-foreground border-accent'
                          : 'bg-background text-muted-foreground border-border hover:border-accent/50'
                      }`}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </FilterAccordion>

            <FilterAccordion
              label="Website"
              icon={<Globe className="w-4 h-4" />}
              isOpen={!!expandedSections['website']}
              onToggle={() => toggleSection('website')}
            >
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                  checked={filters.requireWebsite}
                  onChange={(e) => setFilters({ ...filters, requireWebsite: e.target.checked })}
                />
                Only companies with a website
              </label>
            </FilterAccordion>
          </div>
    </>
  )

  const filtersFooter = (
    <>
        {/* Sidebar Footer Search Actions */}
        <div className="p-4 border-t border-border bg-card/80">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">Result Limit</label>
            <input
              type="number"
              min="1"
              max="100"
              className="w-16 px-1.5 py-0.5 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-accent focus:border-transparent outline-none transition-all text-center font-semibold"
              value={filters.limit}
              onChange={(e) => setFilters({
                ...filters,
                limit: Math.min(100, Math.max(1, parseInt(e.target.value) || 20)),
              })}
            />
          </div>

          <button
            type="submit"
            className="w-full bg-accent text-accent-foreground py-2 rounded-md-s text-xs font-semibold hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-accent cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            Search Prospects
          </button>
        </div>
    </>
  )


  return (
    <div className="flex w-full h-full overflow-hidden bg-background">
      {/* Left Sidebar: Filters (desktop rail) */}
      <form onSubmit={handleSearch} className="hidden lg:flex w-72 shrink-0 border-r border-border bg-card flex-col h-full overflow-hidden select-none">
        {filtersHeader}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-2 flex flex-col gap-1">
          {filtersBody}
        </div>
        {filtersFooter}
      </form>

      {/* Filters as a bottom sheet below lg */}
      <Sheet
        isOpen={isFiltersOpen}
        onClose={() => setIsFiltersOpen(false)}
        title={
          <div className="flex items-center gap-3">
            <h3 className="text-base font-bold text-foreground">Filters</h3>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-[11px] text-accent hover:underline font-semibold"
            >
              Clear All
            </button>
          </div>
        }
        className="lg:hidden"
        footer={
          <form onSubmit={handleSearch}>{filtersFooter}</form>
        }
      >
        <div className="px-4 py-2 flex flex-col gap-1">{filtersBody}</div>
      </Sheet>


      {/* Right Column: Search Results Title & Table */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {/* Results Header Pane */}
        <div className="px-4 sm:px-6 py-4 border-b border-border bg-card flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-foreground font-display leading-tight">Prospect Search</h1>
            <p className="hidden sm:block text-xs text-muted-foreground mt-0.5">Find high-fit leads and add them directly to your marketing campaigns.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsFiltersOpen(true)}
            className="lg:hidden shrink-0 text-xs border border-border bg-card px-3 py-2 rounded-md-s font-semibold flex items-center gap-1.5 hover:bg-muted transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-accent text-accent-foreground rounded-full px-1.5 text-[10px] font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={() => setIsAddToListOpen(true)}
              className="text-xs bg-accent text-accent-foreground px-3 py-1.5 rounded-md-s font-semibold flex items-center gap-1.5 hover:brightness-110 active:scale-95 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add {selectedIds.size} to list</span>
            </button>
          )}
        </div>

        {/* Results Info/Stats bar */}
        <div className="px-6 py-2.5 border-b border-border flex justify-between items-center bg-card/10 shrink-0 select-none">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground/80">Search Results</span>
            <span className="text-[10px] text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-full font-bold">
              {totalMatches > contacts.length
                ? `${contacts.length} of ${totalMatches.toLocaleString()} matches`
                : `${contacts.length} found`}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground font-medium">
            Table view
          </div>
        </div>

        {/* Partial failures and variant-cap truncation: the results below are
            real but incomplete, which is worse than an outright error if we
            don't say so. */}
        {warnings.length > 0 && (
          <div className="px-6 py-2 border-b border-border bg-amber-500/10 shrink-0 flex flex-col gap-1">
            {warnings.map((warning, i) => (
              <div key={i} className="flex items-start gap-2 text-amber-600 dark:text-amber-500">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="text-[10px] leading-snug font-medium">{warning}</span>
              </div>
            ))}
          </div>
        )}

        {/* Main scrollable results container */}
        <div className="flex-1 overflow-auto custom-scrollbar bg-background">
          {/* Mobile card list — the table below needs 600px to be legible */}
          <ul className="md:hidden divide-y divide-border">
            {error ? (
              <li className="px-4 py-12 text-center">
                {error.message === 'INSUFFICIENT_FUNDS' ? (
                  <div className="flex flex-col items-center gap-3 max-w-sm mx-auto">
                    <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <h4 className="font-bold text-foreground text-sm">Credits Balance Exhausted</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Your Generect account has run out of search credits. Please upgrade your plan or top up your balance to continue searching prospects.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-destructive">
                    <AlertCircle className="w-6 h-6" />
                    <span className="text-xs font-semibold">{error.message}</span>
                  </div>
                )}
              </li>
            ) : isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="p-4 animate-pulse flex items-center gap-3">
                  <div className="w-8 h-8 bg-muted rounded-full shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="w-32 h-4 bg-muted rounded" />
                    <div className="w-24 h-3 bg-muted rounded" />
                  </div>
                </li>
              ))
            ) : contacts.length === 0 ? (
              <li className="px-4 py-12 text-center text-muted-foreground text-xs font-medium">
                No results found. Try adjusting your filters.
              </li>
            ) : (
              contacts.map((contact) => (
                <li key={contact.id} className="p-4 flex items-start gap-3">
                  <label className="touch-target flex items-center justify-center shrink-0 -m-2 p-2">
                    <input
                      type="checkbox"
                      className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                      checked={selectedIds.has(contact.id)}
                      onChange={() => toggleSelection(contact.id)}
                    />
                  </label>
                  <Avatar name={`${contact.firstName} ${contact.lastName}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground text-sm truncate">
                      {contact.firstName} {contact.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground font-medium truncate">{contact.title}</p>
                    <p className="text-xs text-foreground font-medium truncate mt-0.5">{contact.company}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {contact.emailAddresses[0] ? (
                        <Badge variant="info">{contact.emailAddresses[0].email}</Badge>
                      ) : noEmailIds.has(contact.id) ? (
                        <span className="text-xs text-muted-foreground italic">No email found</span>
                      ) : contact.linkedinUrl ? (
                        <button
                          type="button"
                          disabled={revealingIds.has(contact.id)}
                          onClick={() => revealEmail(contact)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md-xs text-[11px] font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {revealingIds.has(contact.id) ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Revealing...</>
                          ) : (
                            <><Mail className="w-3 h-3" /> Reveal Email</>
                          )}
                        </button>
                      ) : null}
                      {contact.phoneNumbers[0] && (
                        <Badge variant="default">{contact.phoneNumbers[0].number}</Badge>
                      )}
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>

          <table className="hidden md:table w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground bg-card/20 sticky top-0 z-10 backdrop-blur-sm select-none">
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider w-12 text-center">
                  <input
                    type="checkbox"
                    className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                    checked={contacts.length > 0 && selectedIds.size === contacts.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onSelectionChange(new Set(contacts.map(c => c.id)), contacts)
                      } else {
                        onSelectionChange(new Set(), contacts)
                      }
                    }}
                  />
                </th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Contact</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Company</th>
                <th className="px-6 py-3 text-[10px] font-bold uppercase tracking-wider">Contact Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {error ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center">
                    {error.message === 'INSUFFICIENT_FUNDS' ? (
                      <div className="flex flex-col items-center gap-3 py-10 max-w-sm mx-auto">
                        <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center">
                          <AlertCircle className="w-6 h-6" />
                        </div>
                        <h4 className="font-bold text-foreground text-sm">Credits Balance Exhausted</h4>
                        <p className="text-xs text-muted-foreground text-center leading-relaxed">
                          Your Generect account has run out of search credits. Please upgrade your plan or top up your balance to continue searching prospects.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-destructive py-8">
                        <AlertCircle className="w-6 h-6" />
                        <span className="text-xs font-semibold">{error.message}</span>
                      </div>
                    )}
                  </td>
                </tr>
              ) : isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-5"><div className="w-4 h-4 bg-muted rounded mx-auto" /></td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-muted rounded-full" />
                        <div className="space-y-2">
                          <div className="w-32 h-4 bg-muted rounded" />
                          <div className="w-24 h-3 bg-muted rounded" />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5"><div className="w-40 h-4 bg-muted rounded" /></td>
                    <td className="px-6 py-5"><div className="w-32 h-4 bg-muted rounded" /></td>
                  </tr>
                ))
              ) : contacts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center text-muted-foreground text-xs font-medium">
                    No results found. Try adjusting your filters in the sidebar.
                  </td>
                </tr>
              ) : (
                contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-card/30 transition-colors group">
                    <td className="px-6 py-4 text-center">
                      <input
                        type="checkbox"
                        className="rounded border-border text-accent focus:ring-accent cursor-pointer"
                        checked={selectedIds.has(contact.id)}
                        onChange={() => toggleSelection(contact.id)}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={`${contact.firstName} ${contact.lastName}`} />
                        <div>
                          <p className="font-semibold text-foreground text-sm leading-none mb-1">
                            {contact.firstName} {contact.lastName}
                          </p>
                          <p className="text-xs text-muted-foreground font-medium">{contact.title}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-foreground">{contact.company}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {contact.emailAddresses[0] ? (
                          <Badge variant="info">{contact.emailAddresses[0].email}</Badge>
                        ) : noEmailIds.has(contact.id) ? (
                          <span className="text-xs text-muted-foreground italic">No email found</span>
                        ) : contact.linkedinUrl ? (
                          <button
                            type="button"
                            disabled={revealingIds.has(contact.id)}
                            onClick={() => revealEmail(contact)}
                            title="Uses one Generect credit"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md-xs text-[11px] font-semibold border border-accent/30 text-accent hover:bg-accent/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {revealingIds.has(contact.id) ? (
                              <><Loader2 className="w-3 h-3 animate-spin" /> Revealing...</>
                            ) : (
                              <><Mail className="w-3 h-3" /> Reveal Email</>
                            )}
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">—</span>
                        )}
                        {contact.phoneNumbers[0] && (
                          <Badge variant="default">{contact.phoneNumbers[0].number}</Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog
        isOpen={isAddToListOpen}
        onClose={closeAddToListDialog}
        title={`Add ${selectedIds.size} contact${selectedIds.size === 1 ? '' : 's'} to list`}
        className="max-w-md"
      >
        <div className="p-6 space-y-4">
          {addToListMutation.isError && (
            <div className="text-xs text-destructive font-medium">
              {(addToListMutation.error as Error).message}
            </div>
          )}
          {isCreatingList ? (
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                New list name
              </label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md-s focus:ring-1 focus:ring-accent focus:border-transparent outline-none"
                  placeholder="e.g. Q1 Outreach"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newListName.trim()) {
                      e.preventDefault()
                      createListMutation.mutate(newListName.trim())
                    }
                  }}
                />
                <Button
                  disabled={!newListName.trim()}
                  isLoading={createListMutation.isPending}
                  onClick={() => createListMutation.mutate(newListName.trim())}
                >
                  Create
                </Button>
              </div>
              {createListMutation.isError && (
                <div className="text-xs text-destructive font-medium mt-1.5">
                  {(createListMutation.error as Error).message}
                </div>
              )}
              <button
                type="button"
                onClick={() => { setIsCreatingList(false); setNewListName('') }}
                className="text-[10px] text-accent hover:underline font-semibold mt-2"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                Select a list
              </label>
              <select
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md-s focus:ring-1 focus:ring-accent focus:border-transparent outline-none"
                value={targetListId}
                onChange={(e) => setTargetListId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">Choose a list...</option>
                {lists.map((list: any) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setIsCreatingList(true)}
                className="text-[10px] text-accent hover:underline font-semibold mt-2 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />
                Create new list
              </button>
            </div>
          )}
          {(() => {
            const selected = contacts.filter((c) => selectedIds.has(c.id))
            const skipped = selected.filter((c) => !c.emailAddresses[0]?.email).length
            if (skipped === 0) return null
            return (
              <div className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-md-s p-2.5">
                {skipped} of {selected.length} selected {skipped === 1 ? 'contact has' : 'contacts have'} no
                revealed email and will be skipped. Reveal their emails first to include them.
              </div>
            )
          })()}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={closeAddToListDialog}>
              Cancel
            </Button>
            <Button
              disabled={!targetListId || contacts.filter((c) => selectedIds.has(c.id)).every((c) => !c.emailAddresses[0]?.email)}
              isLoading={addToListMutation.isPending}
              onClick={() => {
                if (!targetListId) return
                const selectedContacts = contacts.filter((c) => selectedIds.has(c.id))
                addToListMutation.mutate({
                  listId: targetListId,
                  contacts: selectedContacts
                    .filter((c) => c.emailAddresses[0]?.email)
                    .map((c) => ({
                      email: c.emailAddresses[0].email,
                      attributes: {
                        FIRSTNAME: c.firstName,
                        LASTNAME: c.lastName,
                        JOB_TITLE: c.title,
                        COMPANY: c.company,
                      },
                    })),
                })
              }}
            >
              Add to List
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
