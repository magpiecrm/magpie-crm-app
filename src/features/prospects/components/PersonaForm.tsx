import { useRef, useState, useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { X, Check, Info } from 'lucide-react'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { prospectingStatusFn } from '../../../server/functions'
import { PersonaMindMap } from './PersonaMindMap'
import { PersonaSummaryCard } from './PersonaSummaryCard'
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

interface PersonaFormProps {
  title: string
  initial: PersonaFormValues
  onSave: (data: PersonaFormValues) => void
  isSaving: boolean
  /** Why the last save failed. */
  error?: string | null
}

export function PersonaForm({ title, initial, onSave, isSaving, error }: PersonaFormProps) {
  const navigate = useNavigate()
  const [persona, setPersona] = useState(initial)
  const [aiUpdatedKeys, setAiUpdatedKeys] = useState<Set<string>>(new Set())
  const aiFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keyed as the criteria are, so the copilot's changes open the filters they touch.
  const [expanded, setExpanded] = useState<Record<keyof PersonaCriteria, boolean>>({
    titles: true,
    seniorities: false,
    industries: true,
    companySizes: false,
    country: false,
    keyword: false,
  })
  const section = (key: keyof PersonaCriteria) => ({ isOpen: expanded[key], onToggle: () => setExpanded((prev) => ({ ...prev, [key]: !prev[key] })) })
  // Search's own notes on titles and countries depend on who runs the search (Shares the sidebar's status query).
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
    setExpanded(prev => {
      const next = { ...prev }
      touched.forEach(k => { if (k in next) next[k as keyof PersonaCriteria] = true })
      return next
    })
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

  const flash = (key: string) => (aiUpdatedKeys.has(key) ? 'ring-1 ring-accent rounded-md-s transition-shadow' : 'transition-shadow')

  const setCriteria = <K extends keyof PersonaCriteria>(key: K, value: PersonaCriteria[K]) =>
    setPersona(p => ({ ...p, criteria: { ...p.criteria, [key]: value } }))

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-display text-foreground">{title}</h1>
        <div className="flex items-center gap-2">
          <Link
            to="/collection/personas"
            className="p-1.5 rounded-md-s text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className={`px-6 pt-5 max-w-md ${flash('name')}`}>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Persona name <span className="text-destructive">*</span>
            </label>
            <input
              className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="e.g. Marketing leaders at SaaS companies"
              value={persona.name}
              onChange={e => setPersona(p => ({ ...p, name: e.target.value }))}
            />
          </div>

          {/* Two-pane: Filters + Mind Map */}
          <div className="flex flex-col lg:flex-row gap-6 px-4 sm:px-6 py-5 items-stretch lg:items-start">
            {/* Left: Filters */}
            <div className="w-full lg:w-72 shrink-0 card border border-border rounded-md-m overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-1.5 bg-card/50">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Filters</h3>
                <span title="The filters Prospect Search uses when you apply this persona">
                  <Info className="w-3 h-3 text-muted-foreground" />
                </span>
              </div>
              <div className="px-4">
                <div className={flash('titles')}>
                  <TitlesField value={c.titles} onChange={(v) => setCriteria('titles', v)} hosted={hosted} {...section('titles')} />
                </div>
                <div className={flash('seniorities')}>
                  <SeniorityField value={c.seniorities} onChange={(v) => setCriteria('seniorities', v)} {...section('seniorities')} />
                </div>
                <div className={flash('industries')}>
                  <IndustryField value={c.industries} onChange={(v) => setCriteria('industries', v)} {...section('industries')} />
                </div>
                <div className={flash('companySizes')}>
                  <CompanySizeField
                    value={c.companySizes}
                    onChange={(v) => setCriteria('companySizes', v)}
                    needsTerm={c.companySizes.length > 0 && c.industries.length === 0 && !c.keyword.trim()}
                    {...section('companySizes')}
                  />
                </div>
                <div className={flash('country')}>
                  <CountryField value={c.country} onChange={(v) => setCriteria('country', v)} hosted={hosted} {...section('country')} />
                </div>
                <div className={flash('keyword')}>
                  <KeywordField value={c.keyword} onChange={(v) => setCriteria('keyword', v)} {...section('keyword')} />
                </div>
              </div>
            </div>

            {/* Right: Mind Map + Summary */}
            <div className="flex-1 space-y-4 min-w-0">
              <div className="card border border-border rounded-md-m overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-1.5 bg-card/50">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Persona map</h3>
                  <span title="Updates live as you add filters">
                    <Info className="w-3 h-3 text-muted-foreground" />
                  </span>
                </div>
                <div className="p-4 flex items-center justify-center">
                  <PersonaMindMap name={persona.name} criteria={persona.criteria} />
                </div>
              </div>
              <PersonaSummaryCard persona={persona} />
            </div>
          </div>

          {/* Notes */}
          <div className="px-6 pb-6 space-y-4 max-w-3xl">
            <div className="card border border-border rounded-md-m p-6 space-y-5">
              <div className={flash('description')}>
                <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  placeholder="Short summary of who this persona represents"
                  value={persona.description}
                  onChange={e => setPersona(p => ({ ...p, description: e.target.value }))}
                />
              </div>
              <div className={flash('painPoints')}>
                <label className="block text-xs text-muted-foreground mb-1">Pain points</label>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  placeholder="What problems does this persona have?"
                  value={persona.painPoints}
                  onChange={e => setPersona(p => ({ ...p, painPoints: e.target.value }))}
                />
              </div>
              <div className={flash('valueProp')}>
                <label className="block text-xs text-muted-foreground mb-1">Value proposition</label>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  placeholder="Why should this persona care about our product?"
                  value={persona.valueProp}
                  onChange={e => setPersona(p => ({ ...p, valueProp: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-6 py-3 border-t border-border shrink-0">
          <Notice level="error">{error}</Notice>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 bg-card/50">
        <Link
          to="/collection/personas"
          className="hidden sm:inline text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          All personas
        </Link>
        <div className="flex items-center gap-3 ml-auto">
          <button
            onClick={() => navigate({ to: '/collection/personas' })}
            className="px-4 py-2 text-sm font-medium border border-border rounded-md-s text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(persona)}
            disabled={isSaving || !persona.name.trim()}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-md-s text-sm font-medium hover:bg-primary/85 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center gap-2 whitespace-nowrap"
          >
            {isSaving ? 'Saving…' : <><Check className="w-4 h-4" /> Save persona</>}
          </button>
        </div>
      </div>
    </div>
  )
}
