import type { ReactNode } from 'react'
import { Briefcase, Check, Factory, Globe, Search, UserCheck, Users2 } from 'lucide-react'
import { TagInput } from '../../../components/ui/TagInput'
import { FilterAccordion } from '../../../components/ui/FilterAccordion'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { HEADCOUNT_BUCKETS, SENIORITY_LABEL, SENIORITY_LEVELS, type HeadcountBucket, type Seniority } from '../../../server/prospecting/types'
import { SUPPORTED_COUNTRIES } from '../../../server/prospecting/geo'
import { INDUSTRIES } from '../constants/industries'
import { JOB_TITLES } from '../constants/jobTitles'

// People search's filters: Prospect Search's people form and the persona
// builder both use these, so a persona holds exactly what a search can take.
// In search's sidebar each is an accordion; in the persona form (`form`) each
// is a labelled field like any other, always open.

export const FILTER_INPUT_CLASS =
  'w-full px-2 py-1.5 text-xs bg-background border border-border rounded focus:ring-1 focus:ring-accent focus:border-transparent outline-none'

/** "Founders and owners": what the person running a small company calls themselves. */
const FOUNDER_TITLES = ['Founder', 'Owner', 'CEO', 'Managing Director', 'President']
/** A department's leaders: the search finds its Heads of, VPs and Directors, however they word it. */
const LEADER_TITLES = ['Sales', 'Marketing', 'Operations', 'Finance', 'Engineering'].map((department) => `${department} leaders`)
const MAX_TITLES = 5
const KNOWN_INDUSTRIES = new Set<string>(INDUSTRIES)

/** An accordion in search's sidebar (`isOpen`, `onToggle`), or a field in the persona form (`form`). */
interface Section {
  isOpen?: boolean
  onToggle?: () => void
  form?: boolean
}

interface FieldProps<T> extends Section {
  value: T
  onChange: (value: T) => void
}

const hint = (form?: boolean) => (form ? 'text-[13px] text-muted-foreground leading-relaxed' : 'text-[10px] text-muted-foreground mt-1.5 leading-snug')
const quickPick = (form?: boolean) =>
  `${form ? 'text-[13px] font-medium' : 'text-[11px] font-semibold'} text-accent hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed`

/** "1001-5000" as people read it: "1,001–5,000". */
export function formatBand(band: string) {
  return band.replace(/\d+/g, (n) => Number(n).toLocaleString('en-GB')).replace('-', '–')
}

function Shell({ label, icon, count, section, children }: { label: string; icon: ReactNode; count: number; section: Section; children: ReactNode }) {
  if (section.form) {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        {children}
      </div>
    )
  }
  return (
    <FilterAccordion label={label} icon={icon} isOpen={!!section.isOpen} onToggle={section.onToggle ?? (() => {})} badgeCount={count}>
      {children}
    </FilterAccordion>
  )
}

/**
 * Several from a fixed list: ticks in search's sidebar; in the form, all in
 * view on an even grid, a chosen one tinted with a check (the cells don't
 * move when one is chosen).
 */
function Choices<T extends string>({ label, options, value, onChange, format, disabled = false, form }: {
  label: string
  options: readonly T[]
  value: T[]
  onChange: (value: T[]) => void
  format: (option: T) => string
  disabled?: boolean
  form?: boolean
}) {
  // Kept in the list's order, whatever order they're chosen in.
  const toggle = (o: T, on: boolean) => onChange(options.filter((x) => (x === o ? on : value.includes(x))))
  if (form) {
    return (
      <div role="group" aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((o) => {
          const on = value.includes(o)
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(o, !on)}
              className={`inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-md-xs border px-2 text-[13px] tabular-nums max-sm:text-sm transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 ${
                on ? 'border-accent bg-accent/10 font-medium text-foreground shadow-[inset_0_0_0_1px_var(--accent)]' : 'border-input bg-card text-foreground hover:bg-muted'
              }`}
            >
              {on && <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" />}
              <span className="truncate">{format(o)}</span>
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-1">
      {options.map((o) => (
        <label key={o} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(o)}
            disabled={disabled}
            onChange={(e) => toggle(o, e.target.checked)}
          />
          {format(o)}
        </label>
      ))}
    </div>
  )
}

/** `extra`: anything the form adds under the titles, such as search's related-roles switch. */
export function TitlesField({ value, onChange, hosted, extra, ...section }: FieldProps<string[]> & { hosted: boolean; extra?: ReactNode }) {
  const { form } = section
  return (
    <Shell label="Job titles" icon={<Briefcase className="w-4 h-4" />} count={value.length} section={section}>
      <TagInput label="Job titles" variant={form ? 'field' : 'compact'} tags={value} placeholder="e.g. Head of Marketing" onChange={onChange} suggestions={JOB_TITLES} />
      <p className={hint(form)}>{hosted ? 'Up to 5.' : 'Up to 5. Each title is a separate search (3 credits per page).'}</p>
      <div className={form ? '' : 'mt-2'}>
        <div className={`flex flex-wrap ${form ? 'gap-x-4 gap-y-1' : 'gap-x-3 gap-y-0.5'}`}>
          {FOUNDER_TITLES.some((t) => !value.includes(t)) && (
            <button type="button" onClick={() => onChange(FOUNDER_TITLES)} className={quickPick(form)}>
              Founders and owners
            </button>
          )}
          {value.includes('Founder') && !value.includes('CEO') && (
            <button type="button" disabled={value.length >= MAX_TITLES} onClick={() => onChange([...value, 'CEO'])} className={quickPick(form)}>
              Add CEO
            </button>
          )}
          {LEADER_TITLES.filter((t) => !value.includes(t)).map((t) => (
            <button key={t} type="button" disabled={value.length >= MAX_TITLES} onClick={() => onChange([...value, t])} className={quickPick(form)}>
              {t}
            </button>
          ))}
        </div>
        <p className={form ? `${hint(form)} mt-1` : 'text-[10px] text-muted-foreground leading-snug mt-0.5'}>
          Founders and owners searches Founder, Owner, CEO, Managing Director and President
          {value.length ? ', in place of the titles above' : ''}. A department's leaders finds its Heads, VPs and Directors however
          they word it, as does a title like "Head of Sales".
        </p>
      </div>
      {extra}
    </Shell>
  )
}

export function SeniorityField({ value, onChange, ...section }: FieldProps<Seniority[]>) {
  return (
    <Shell label="Seniority" icon={<UserCheck className="w-4 h-4" />} count={value.length} section={section}>
      <Choices label="Seniority" options={SENIORITY_LEVELS} value={value} onChange={onChange} format={(s) => SENIORITY_LABEL[s]} form={section.form} />
      <p className={hint(section.form)}>Worked out from each person's title.</p>
    </Shell>
  )
}

export function IndustryField({ value, onChange, ...section }: FieldProps<string[]>) {
  return (
    <Shell label="Industry" icon={<Factory className="w-4 h-4" />} count={value.length} section={section}>
      <TagInput
        label="Industries"
        variant={section.form ? 'field' : 'compact'}
        tags={value}
        placeholder="e.g. Software Development"
        suggestions={INDUSTRIES}
        onChange={(industries) => onChange(industries.filter((i) => KNOWN_INDUSTRIES.has(i)))}
      />
      <p className={hint(section.form)}>Pick from the list. The industry of the company they work at.</p>
    </Shell>
  )
}

/** `needsTerm`: sizes are set with no industry or keyword to find companies by. */
export function CompanySizeField({
  value,
  onChange,
  companyChosen = false,
  needsTerm,
  ...section
}: FieldProps<HeadcountBucket[]> & { companyChosen?: boolean; needsTerm: boolean }) {
  return (
    <Shell label="Company size" icon={<Users2 className="w-4 h-4" />} count={value.length} section={section}>
      <Choices
        label="Company size"
        options={HEADCOUNT_BUCKETS}
        value={value}
        onChange={onChange}
        format={section.form ? formatBand : (b) => b}
        disabled={companyChosen}
        form={section.form}
      />
      <p className={hint(section.form)}>
        {companyChosen
          ? 'Not used while a company is chosen.'
          : needsTerm
            ? 'Add an industry or keyword too: companies of this size are found first, then the people who work there.'
            : 'Companies of this size are found first, then the people who work there, so no credits go on people at other sizes.'}
      </p>
    </Shell>
  )
}

export function CountryField({ value, onChange, hosted, ...section }: FieldProps<string> & { hosted: boolean }) {
  return (
    <Shell label="Country" icon={<Globe className="w-4 h-4" />} count={value ? 1 : 0} section={section}>
      <TagInput
        label="Country"
        variant={section.form ? 'field' : 'compact'}
        max={1}
        tags={value ? [value] : []}
        placeholder="e.g. United Kingdom"
        suggestions={SUPPORTED_COUNTRIES}
        onChange={(t) => onChange(t[0] ?? '')}
      />
      <p className={hint(section.form)}>
        {hosted
          ? 'Pick a country from the list for the fullest results.'
          : 'Countries in the list are filtered by SocialFetch. Others are filtered after each page, so pages can be thin.'}
      </p>
    </Shell>
  )
}

export function KeywordField({ value, onChange, ...section }: FieldProps<string>) {
  return (
    <Shell label="Keyword" icon={<Search className="w-4 h-4" />} count={value ? 1 : 0} section={section}>
      <input
        className={section.form ? INPUT_CLASS : FILTER_INPUT_CLASS}
        aria-label="Keyword"
        value={value}
        placeholder="e.g. fintech"
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  )
}
