import { useRef, useState, useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { X, Check, Briefcase, Factory, MapPin, Users2, Info, Layers, Ban } from 'lucide-react'
import { TagInput } from '../../../components/ui/TagInput'
import { FilterAccordion } from '../../../components/ui/FilterAccordion'
import { PersonaMindMap } from './PersonaMindMap'
import { PersonaSummaryCard } from './PersonaSummaryCard'
import { copilotStore } from '../../copilot/copilotStore'
import { INDUSTRIES } from '../constants/industries'
import { LOCATIONS } from '../constants/locations'
import { SENIORITIES } from '../constants/seniorities'
import type { PersonaCriteria } from '../types'

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
}


export function PersonaForm({ title, initial, onSave, isSaving }: PersonaFormProps) {
  const navigate = useNavigate()
  const [persona, setPersona] = useState(initial)
  const [aiUpdatedKeys, setAiUpdatedKeys] = useState<Set<string>>(new Set())
  const aiFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    title: true,
    industry: true,
    seniority: false,
    location: false,
    employeeCount: false,
    excludedTitles: false,
  })

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  // Merge a copilot updatePersona patch into form state; form state stays the
  // single source of truth (manual edits reach the AI on its next request).
  const applyPersonaUpdates = (updates: PersonaUpdates) => {
    setPersona(p => ({
      ...p,
      ...updates,
      criteria: { ...p.criteria, ...(updates.criteria ?? {}) },
    }))

    const touched = new Set<string>(Object.keys(updates.criteria ?? {}))
    for (const key of ['name', 'description', 'painPoints', 'valueProp'] as const) {
      if (updates[key] !== undefined) touched.add(key)
    }
    setExpanded(prev => {
      const next = { ...prev }
      touched.forEach(k => { if (k in next) next[k] = true })
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
              Persona Name <span className="text-destructive">*</span>
            </label>
            <input
              className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="e.g. Marketing Leaders"
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
                <span title="Criteria used to search Prospect Search">
                  <Info className="w-3 h-3 text-muted-foreground" />
                </span>
              </div>
              <div className="px-4">
                <div className={flash('title')}>
                  <FilterAccordion
                    label="Job Titles"
                    icon={<Briefcase className="w-4 h-4" />}
                    isOpen={!!expanded.title}
                    onToggle={() => toggle('title')}
                    badgeCount={persona.criteria.title.length}
                  >
                    <TagInput
                      label="Job Titles"
                      tags={persona.criteria.title}
                      placeholder="e.g. VP Sales, Head of Marketing"
                      onChange={val => setCriteria('title', val)}
                    />
                  </FilterAccordion>
                </div>

                <div className={flash('seniority')}>
                  <FilterAccordion
                    label="Seniority"
                    icon={<Layers className="w-4 h-4" />}
                    isOpen={!!expanded.seniority}
                    onToggle={() => toggle('seniority')}
                    badgeCount={persona.criteria.seniority.length}
                  >
                    <TagInput
                      label="Seniority Levels"
                      tags={persona.criteria.seniority}
                      placeholder="e.g. VP, Director, C-Level"
                      suggestions={SENIORITIES}
                      onChange={val => setCriteria('seniority', val)}
                    />
                  </FilterAccordion>
                </div>

                <div className={`${flash('industry')} ${flash('keywords')}`}>
                  <FilterAccordion
                    label="Industry & Keywords"
                    icon={<Factory className="w-4 h-4" />}
                    isOpen={!!expanded.industry}
                    onToggle={() => toggle('industry')}
                    badgeCount={persona.criteria.industry.length + persona.criteria.keywords.length}
                  >
                    <div className="space-y-3">
                      <TagInput
                        label="Industries"
                        tags={persona.criteria.industry}
                        placeholder="e.g. Software Development, Financial Services"
                        suggestions={INDUSTRIES}
                        onChange={val => setCriteria('industry', val)}
                      />
                      <TagInput
                        label="Keywords"
                        tags={persona.criteria.keywords}
                        placeholder="e.g. Series B, hiring SDRs"
                        onChange={val => setCriteria('keywords', val)}
                      />
                    </div>
                  </FilterAccordion>
                </div>

                <div className={flash('location')}>
                  <FilterAccordion
                    label="Location"
                    icon={<MapPin className="w-4 h-4" />}
                    isOpen={!!expanded.location}
                    onToggle={() => toggle('location')}
                    badgeCount={persona.criteria.location.length}
                  >
                    <TagInput
                      label="Locations"
                      tags={persona.criteria.location}
                      suggestions={LOCATIONS}
                      placeholder="e.g. United States, London, United Kingdom"
                      onChange={val => setCriteria('location', val)}
                    />
                  </FilterAccordion>
                </div>

                <div className={flash('employeeCount')}>
                  <FilterAccordion
                    label="# Employees"
                    icon={<Users2 className="w-4 h-4" />}
                    isOpen={!!expanded.employeeCount}
                    onToggle={() => toggle('employeeCount')}
                    badgeCount={persona.criteria.employeeCount ? 1 : 0}
                  >
                    <input
                      className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                      placeholder="e.g. 51-200"
                      value={persona.criteria.employeeCount}
                      onChange={e => setCriteria('employeeCount', e.target.value)}
                    />
                  </FilterAccordion>
                </div>

                <div className={flash('excludedTitles')}>
                  <FilterAccordion
                    label="Excluded Titles"
                    icon={<Ban className="w-4 h-4" />}
                    isOpen={!!expanded.excludedTitles}
                    onToggle={() => toggle('excludedTitles')}
                    badgeCount={persona.criteria.excludedTitles.length}
                  >
                    <TagInput
                      label="Exclude Titles"
                      tags={persona.criteria.excludedTitles}
                      placeholder="e.g. Assistant, Intern"
                      onChange={val => setCriteria('excludedTitles', val)}
                    />
                  </FilterAccordion>
                </div>
              </div>
            </div>

            {/* Right: Mind Map + Summary */}
            <div className="flex-1 space-y-4 min-w-0">
              <div className="card border border-border rounded-md-m overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-1.5 bg-card/50">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Persona Map</h3>
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
                <label className="block text-xs text-muted-foreground mb-1">Pain Points</label>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 rounded-md-s border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  placeholder="What problems does this persona have?"
                  value={persona.painPoints}
                  onChange={e => setPersona(p => ({ ...p, painPoints: e.target.value }))}
                />
              </div>
              <div className={flash('valueProp')}>
                <label className="block text-xs text-muted-foreground mb-1">Value Proposition</label>
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

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 bg-card/50">
        <Link
          to="/collection/personas"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          Manage Personas
        </Link>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: '/collection/personas' })}
            className="px-4 py-2 text-sm font-medium border border-border rounded-md-s text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(persona)}
            disabled={isSaving || !persona.name.trim()}
            className="bg-accent text-accent-foreground px-5 py-2 rounded-md-s text-sm font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer flex items-center gap-2"
          >
            {isSaving ? 'Saving...' : <><Check className="w-4 h-4" /> Save Persona</>}
          </button>
        </div>
      </div>
    </div>
  )
}
