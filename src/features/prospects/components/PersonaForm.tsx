import { useRef, useState, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Search } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { prospectingStatusFn } from '../../../server/functions'
import { PersonaSummaryCard, fieldAnchor } from './PersonaSummaryCard'
import { CompanySizeField, CountryField, IndustryField, KeywordField, SeniorityField, TitlesField } from './PeopleFilterFields'
import { copilotStore } from '../../copilot/copilotStore'
import { normalizePersonaCriteria, type PersonaCriteria } from '../types'

export interface PersonaFormValues {
  name: string
  description: string
  criteria: PersonaCriteria
  painPoints: string
  valueProp: string
}

// Partial persona patch handed back from the AI copilot's updatePersona action.
export interface PersonaUpdates {
  name?: string
  description?: string
  painPoints?: string
  valueProp?: string
  criteria?: Partial<PersonaCriteria>
}

/** Where to go once saved: back to the list, or into Prospect Search with this persona. */
export type AfterSave = 'list' | 'search'

interface PersonaFormProps {
  title: string
  /** Under the title: what the page is for, or (editing) when it was last saved. */
  subtitle?: ReactNode
  initial: PersonaFormValues
  onSave: (data: PersonaFormValues, then: AfterSave) => void
  isSaving: boolean
  /** Why the last save failed. */
  error?: string | null
  /** The page's own actions beside the title, given what's in the form (an existing persona's Duplicate and Delete). */
  actions?: (current: PersonaFormValues) => ReactNode
}

/** One card of the form. */
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-md-m border border-border bg-card shadow-xs">
      <header className="px-5 pt-5">
        <h2 className="text-[17px] font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-pretty text-[13px] text-muted-foreground">{description}</p>}
      </header>
      <div className="flex flex-col gap-6 p-5">{children}</div>
    </section>
  )
}

/** A text box that grows with what's written in it, so nothing is cut off mid-line. */
function GrowingTextarea({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={2}
      className={`${INPUT_CLASS} resize-none overflow-hidden leading-[1.45]`}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  )
}

const DEFAULT_SUBTITLE = 'Who to look for in Prospect Search, and what the AI Copilot should know when it writes to them.'

export function PersonaForm({ title, subtitle = DEFAULT_SUBTITLE, initial, onSave, isSaving, error, actions }: PersonaFormProps) {
  const navigate = useNavigate()
  const [persona, setPersona] = useState(initial)
  const [nameMissing, setNameMissing] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const [aiUpdatedKeys, setAiUpdatedKeys] = useState<Set<string>>(new Set())
  const aiFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Search's own notes on titles and countries depend on who runs the search (shares the sidebar's status query).
  const { data: status } = useQuery({ queryKey: queryKeys.prospects.status(), queryFn: () => prospectingStatusFn() })
  const hosted = Boolean(status?.managed)
  const c = persona.criteria

  // Merge a copilot updatePersona patch into form state; form state stays the
  // single source of truth (manual edits reach the AI on its next request).
  const applyPersonaUpdates = (updates: PersonaUpdates) => {
    setPersona(p => ({
      ...p,
      ...updates,
      // Anything search couldn't take (an industry off the list, say) is left out.
      criteria: normalizePersonaCriteria({ ...p.criteria, ...(updates.criteria ?? {}) }),
    }))

    const touched = new Set<string>(Object.keys(updates.criteria ?? {}))
    for (const key of ['name', 'description', 'painPoints', 'valueProp'] as const) {
      if (updates[key] !== undefined) touched.add(key)
    }
    setAiUpdatedKeys(touched)
    if (aiFlashTimer.current) clearTimeout(aiFlashTimer.current)
    aiFlashTimer.current = setTimeout(() => setAiUpdatedKeys(new Set()), 2000)
  }

  useEffect(() => {
    copilotStore.setPersonaContext({ persona })
  }, [persona])

  useEffect(() => {
    copilotStore.setOnPersonaAction(applyPersonaUpdates)
    return () => {
      copilotStore.setPersonaContext(null)
      copilotStore.setOnPersonaAction(null)
    }
  }, [])

  // A field's place in the form: the summary scrolls to it, and it's outlined
  // for a moment when the copilot has just changed it.
  const at = (key: string) => ({
    id: fieldAnchor(key),
    className: `scroll-mt-6 ${aiUpdatedKeys.has(key) ? 'rounded-md-s ring-2 ring-accent ring-offset-4 ring-offset-card transition-shadow' : 'transition-shadow'}`,
  })

  const setCriteria = <K extends keyof PersonaCriteria>(key: K, value: PersonaCriteria[K]) =>
    setPersona(p => ({ ...p, criteria: { ...p.criteria, [key]: value } }))

  const changed = JSON.stringify(persona) !== JSON.stringify(initial)

  const save = (then: AfterSave) => {
    if (!persona.name.trim()) {
      setNameMissing(true)
      nameRef.current?.focus()
      return
    }
    onSave(persona, then)
  }

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
          <Link
            to="/collection/personas"
            className="mb-4 inline-flex items-center gap-1.5 rounded-md-xs text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="h-4 w-4" /> Personas
          </Link>
          <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-display text-foreground break-words">{title}</h1>
              <p className="mt-1 text-pretty text-sm text-muted-foreground">{subtitle}</p>
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 md:-mr-2">{actions(persona)}</div>}
          </header>

          <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="lg:hidden">
              <PersonaSummaryCard persona={persona} compact />
            </div>

            <div className="flex min-w-0 flex-col gap-6">
              <Section title="About">
                <div {...at('name')}>
                  <Field label={<>Name <span className="text-destructive" aria-hidden>*</span><span className="sr-only">(required)</span></>} error={nameMissing && !persona.name.trim() ? 'Give the persona a name to save it.' : undefined}>
                    <input
                      ref={nameRef}
                      required
                      aria-invalid={nameMissing && !persona.name.trim()}
                      className={INPUT_CLASS}
                      placeholder="e.g. Marketing leaders at SaaS companies"
                      value={persona.name}
                      onChange={e => setPersona(p => ({ ...p, name: e.target.value }))}
                    />
                  </Field>
                </div>
                <div {...at('description')}>
                  <Field label="Description">
                    <GrowingTextarea
                      placeholder="e.g. Heads of marketing at software companies who own the pipeline target"
                      value={persona.description}
                      onChange={description => setPersona(p => ({ ...p, description }))}
                    />
                  </Field>
                </div>
              </Section>

              <Section title="Search filters" description="Prospect Search's own filters: Save and search, or Use in Prospect Search on the list, fills them in.">
                <div {...at('titles')}>
                  <TitlesField form value={c.titles} onChange={(v) => setCriteria('titles', v)} hosted={hosted} />
                </div>
                <div {...at('seniorities')}>
                  <SeniorityField form value={c.seniorities} onChange={(v) => setCriteria('seniorities', v)} />
                </div>
                <div {...at('industries')}>
                  <IndustryField form value={c.industries} onChange={(v) => setCriteria('industries', v)} />
                </div>
                <div {...at('companySizes')}>
                  <CompanySizeField
                    form
                    value={c.companySizes}
                    onChange={(v) => setCriteria('companySizes', v)}
                    needsTerm={c.companySizes.length > 0 && c.industries.length === 0 && !c.keyword.trim()}
                  />
                </div>
                <div {...at('country')}>
                  <CountryField form value={c.country} onChange={(v) => setCriteria('country', v)} hosted={hosted} />
                </div>
                <div {...at('keyword')}>
                  <KeywordField form value={c.keyword} onChange={(v) => setCriteria('keyword', v)} />
                </div>
              </Section>

              <Section title="Messaging" description="What the AI Copilot draws on when it writes to them.">
                <div {...at('painPoints')}>
                  <Field label="Pain points">
                    <GrowingTextarea
                      placeholder="e.g. Outbound pipeline is down and SDRs spend hours finding emails by hand"
                      value={persona.painPoints}
                      onChange={painPoints => setPersona(p => ({ ...p, painPoints }))}
                    />
                  </Field>
                </div>
                <div {...at('valueProp')}>
                  <Field label="Value proposition">
                    <GrowingTextarea
                      placeholder="e.g. Verified emails for the exact titles they sell to, so SDRs book more meetings"
                      value={persona.valueProp}
                      onChange={valueProp => setPersona(p => ({ ...p, valueProp }))}
                    />
                  </Field>
                </div>
              </Section>
            </div>

            <aside className="hidden lg:sticky lg:top-6 lg:block">
              <PersonaSummaryCard persona={persona} />
            </aside>
          </div>
        </div>
      </div>

      <div className="relative shrink-0 border-t border-border bg-card shadow-[0_-6px_16px_-10px_rgb(0_0_0/0.25)]">
        {error && (
          <div className="mx-auto max-w-6xl px-4 pt-3 lg:px-8">
            <Notice level="error">{error}</Notice>
          </div>
        )}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-2 px-4 py-3 lg:px-8">
          {changed && (
            <p className="mr-auto flex w-full items-center gap-2 text-[13px] text-muted-foreground sm:w-auto" role="status">
              <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden /> Unsaved changes
            </p>
          )}
          {/* On a phone the back link does Cancel's job, which leaves room to say what the second button does. */}
          <Button variant="ghost" className="max-sm:hidden" onClick={() => navigate({ to: '/collection/personas' })}>
            Cancel
          </Button>
          <Button variant="secondary" className="flex-1 sm:flex-none" leftIcon={<Search className="h-4 w-4 max-sm:hidden" />} disabled={isSaving} onClick={() => save('search')}>
            Save and search
          </Button>
          <Button className="flex-1 sm:flex-none" isLoading={isSaving} onClick={() => save('list')}>
            Save persona
          </Button>
        </div>
      </div>
    </div>
  )
}
