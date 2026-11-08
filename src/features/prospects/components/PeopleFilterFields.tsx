import type { ReactNode } from 'react'
import { Briefcase, Factory, Globe, Search, UserCheck, Users2 } from 'lucide-react'
import { TagInput } from '../../../components/ui/TagInput'
import { FilterAccordion } from '../../../components/ui/FilterAccordion'
import { HEADCOUNT_BUCKETS, SENIORITY_LABEL, SENIORITY_LEVELS, type HeadcountBucket, type Seniority } from '../../../server/prospecting/types'
import { SUPPORTED_COUNTRIES } from '../../../server/prospecting/geo'
import { INDUSTRIES } from '../constants/industries'
import { JOB_TITLES } from '../constants/jobTitles'

// People search's filters, one accordion each: Prospect Search's people form
// and the persona builder both use these, so a persona holds exactly what a
// search can take.

export const FILTER_INPUT_CLASS =
  'w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-accent focus:border-transparent outline-none'

/** "Founders and owners": what the person running a small company calls themselves. */
const FOUNDER_TITLES = ['Founder', 'Owner', 'CEO', 'Managing Director', 'President']
/** A department's leaders: the search finds its Heads of, VPs and Directors, however they word it. */
const LEADER_TITLES = ['Sales', 'Marketing', 'Operations', 'Finance', 'Engineering'].map((department) => `${department} leaders`)
const MAX_TITLES = 5
const KNOWN_INDUSTRIES = new Set<string>(INDUSTRIES)

interface Section {
  isOpen: boolean
  onToggle: () => void
}

interface FieldProps<T> extends Section {
  value: T
  onChange: (value: T) => void
}

const hint = 'text-[10px] text-muted-foreground mt-1.5 leading-snug'
const quickPick = 'text-[11px] font-semibold text-accent hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed'

/** `extra`: anything the form adds under the titles, such as search's related-roles switch. */
export function TitlesField({ value, onChange, hosted, extra, isOpen, onToggle }: FieldProps<string[]> & { hosted: boolean; extra?: ReactNode }) {
  return (
    <FilterAccordion label="Job titles" icon={<Briefcase className="w-4 h-4" />} isOpen={isOpen} onToggle={onToggle} badgeCount={value.length}>
      <TagInput label="Job titles" tags={value} placeholder="e.g. Head of Marketing" onChange={onChange} suggestions={JOB_TITLES} />
      <p className={hint}>{hosted ? 'Up to 5.' : 'Up to 5. Each title is a separate search (3 credits per page).'}</p>
      <div className="mt-2">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {FOUNDER_TITLES.some((t) => !value.includes(t)) && (
            <button type="button" onClick={() => onChange(FOUNDER_TITLES)} className={quickPick}>
              Founders and owners
            </button>
          )}
          {value.includes('Founder') && !value.includes('CEO') && (
            <button type="button" disabled={value.length >= MAX_TITLES} onClick={() => onChange([...value, 'CEO'])} className={quickPick}>
              Add CEO
            </button>
          )}
          {LEADER_TITLES.filter((t) => !value.includes(t)).map((t) => (
            <button key={t} type="button" disabled={value.length >= MAX_TITLES} onClick={() => onChange([...value, t])} className={quickPick}>
              {t}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
          Founders and owners searches Founder, Owner, CEO, Managing Director and President
          {value.length ? ', in place of the titles above' : ''}. A department's leaders finds its Heads, VPs and Directors however
          they word it, as does a title like "Head of Sales".
        </p>
      </div>
      {extra}
    </FilterAccordion>
  )
}

export function SeniorityField({ value, onChange, isOpen, onToggle }: FieldProps<Seniority[]>) {
  return (
    <FilterAccordion label="Seniority" icon={<UserCheck className="w-4 h-4" />} isOpen={isOpen} onToggle={onToggle} badgeCount={value.length}>
      <div className="grid grid-cols-2 gap-1">
        {SENIORITY_LEVELS.map((s) => (
          <label key={s} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-border text-accent focus:ring-accent"
              checked={value.includes(s)}
              onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))}
            />
            {SENIORITY_LABEL[s]}
          </label>
        ))}
      </div>
      <p className={hint}>Worked out from each person's title.</p>
    </FilterAccordion>
  )
}

export function IndustryField({ value, onChange, isOpen, onToggle }: FieldProps<string[]>) {
  return (
    <FilterAccordion label="Industry" icon={<Factory className="w-4 h-4" />} isOpen={isOpen} onToggle={onToggle} badgeCount={value.length}>
      <TagInput
        label="Industries"
        tags={value}
        placeholder="e.g. Software Development"
        suggestions={INDUSTRIES}
        onChange={(industries) => onChange(industries.filter((i) => KNOWN_INDUSTRIES.has(i)))}
      />
      <p className={hint}>Pick from the list. The industry of the company they work at.</p>
    </FilterAccordion>
  )
}

/** `needsTerm`: sizes are set with no industry or keyword to find companies by. */
export function CompanySizeField({
  value,
  onChange,
  companyChosen = false,
  needsTerm,
  isOpen,
  onToggle,
}: FieldProps<HeadcountBucket[]> & { companyChosen?: boolean; needsTerm: boolean }) {
  return (
    <FilterAccordion label="Company size" icon={<Users2 className="w-4 h-4" />} isOpen={isOpen} onToggle={onToggle} badgeCount={value.length}>
      <div className="grid grid-cols-2 gap-1">
        {HEADCOUNT_BUCKETS.map((b) => (
          <label key={b} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-border text-accent focus:ring-accent"
              checked={value.includes(b)}
              disabled={companyChosen}
              // Kept in bucket order, whatever order they're ticked in.
              onChange={(e) => onChange(HEADCOUNT_BUCKETS.filter((x) => (x === b ? e.target.checked : value.includes(x))))}
            />
            {b}
          </label>
        ))}
      </div>
      <p className={hint}>
        {companyChosen
          ? 'Not used while a company is chosen.'
          : needsTerm
            ? 'Add an industry or keyword too: companies of this size are found first, then the people who work there.'
            : 'Companies of this size are found first, then the people who work there, so no credits go on people at other sizes.'}
      </p>
    </FilterAccordion>
  )
}

export function CountryField({ value, onChange, hosted, isOpen, onToggle }: FieldProps<string> & { hosted: boolean }) {
  return (
    <FilterAccordion label="Country" icon={<Globe className="w-4 h-4" />} isOpen={isOpen} onToggle={onToggle} badgeCount={value ? 1 : 0}>
      <TagInput
        label="Country"
        max={1}
        tags={value ? [value] : []}
        placeholder="e.g. United Kingdom"
        suggestions={SUPPORTED_COUNTRIES}
        onChange={(t) => onChange(t[0] ?? '')}
      />
      <p className={hint}>
        {hosted
          ? 'Pick a country from the list for the fullest results.'
          : 'Countries in the list are filtered by SocialFetch. Others are filtered after each page, so pages can be thin.'}
      </p>
    </FilterAccordion>
  )
}

export function KeywordField({ value, onChange, isOpen, onToggle }: FieldProps<string>) {
  return (
    <FilterAccordion label="Keyword" icon={<Search className="w-4 h-4" />} isOpen={isOpen} onToggle={onToggle} badgeCount={value ? 1 : 0}>
      <input className={FILTER_INPUT_CLASS} value={value} placeholder="e.g. fintech" onChange={(e) => onChange(e.target.value)} />
    </FilterAccordion>
  )
}
