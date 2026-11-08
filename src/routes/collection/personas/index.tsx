import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { Plus, UserCircle, Trash2, Pencil, Sparkles } from 'lucide-react'
import { getPersonasFn, getPersonaStatsFn, deletePersonaFn, personaDraftStatusFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { DraftPersonasDialog } from '../../../features/prospects/components/DraftPersonasDialog'
import type { Persona, PersonaCriteria } from '../../../features/prospects/types'
import type { PersonaStats } from '../../../server/personaStats'

export const Route = createFileRoute('/collection/personas/')({
  component: PersonasPage,
})

function criteriaSummary(criteria: PersonaCriteria) {
  const parts: string[] = []
  if (criteria.titles.length) parts.push(`${criteria.titles.length} title${criteria.titles.length !== 1 ? 's' : ''}`)
  if (criteria.industries.length) parts.push(`${criteria.industries.length} industr${criteria.industries.length !== 1 ? 'ies' : 'y'}`)
  if (criteria.companySizes.length) parts.push(`${criteria.companySizes.join(', ')} staff`)
  if (criteria.country) parts.push(criteria.country)
  return parts.length ? parts.join(' · ') : 'No criteria set'
}

const percent = (n: number, of: number) => `${Math.round((n / of) * 100)}%`

/** What came of the people saved with this persona: replies over everyone emailed, opens and clicks over those whose emails tracked them. */
function PersonaResults({ persona, stats }: { persona: Persona; stats?: PersonaStats }) {
  if (!stats?.saved) return <p className="text-xs text-muted-foreground">No one saved with it yet.</p>
  const parts = [`${stats.saved} saved`, `${stats.emailed} emailed`]
  if (stats.emailed) parts.push(`${stats.replied} replied (${percent(stats.replied, stats.emailed)})`)
  const tracked = [
    stats.openTracked ? `${percent(stats.opened, stats.openTracked)} opened` : null,
    stats.clickTracked ? `${percent(stats.clicked, stats.clickTracked)} clicked` : null,
  ].filter(Boolean)
  return (
    <div className="text-xs text-muted-foreground space-y-0.5">
      <p className="text-foreground">{parts.join(' · ')}</p>
      {tracked.length > 0 && <p title="Among those whose emails tracked opens or clicks. Automated opens and clicks are left out.">{tracked.join(' · ')}</p>}
      <Link to="/marketing/contacts" search={{ persona: persona.id }} className="inline-block text-accent hover:underline">
        See contacts
      </Link>
    </div>
  )
}

function PersonasPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: personas = [], isLoading } = useQuery({
    queryKey: queryKeys.prospects.personas(),
    queryFn: () => getPersonasFn(),
  })

  const [drafting, setDrafting] = useState(false)
  const { data: draftStatus } = useQuery({ queryKey: queryKeys.prospects.personaDraftStatus(), queryFn: () => personaDraftStatusFn() })
  const draftButton = draftStatus && (
    <Button variant="outline" onClick={() => setDrafting(true)} leftIcon={<Sparkles className="w-4 h-4" />}>
      Draft with AI
    </Button>
  )

  const { data: stats = {} } = useQuery({
    queryKey: queryKeys.prospects.personaStats(),
    queryFn: () => getPersonaStatsFn(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePersonaFn({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.prospects.personas() }),
  })

  const confirmDelete = (persona: Persona) => {
    const saved = stats[persona.id]?.saved ?? 0
    const found = saved ? ` The ${saved} contact${saved === 1 ? '' : 's'} found with it stay, without it.` : ''
    if (confirm(`Delete "${persona.name}"? This can't be undone.${found}`)) {
      deleteMutation.mutate(persona.id)
    }
  }

  const useInSearch = (persona: Persona) => {
    sessionStorage.setItem('applyPersona', JSON.stringify(persona))
    navigate({ to: '/collection/prospect-search' })
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-2">Personas</h1>
          <p className="text-muted-foreground">Who you sell to, as a set of Prospect Search filters you can apply in one go, with notes on what they care about.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {draftButton}
          <Link
            to="/collection/personas/new"
            className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md-s font-medium hover:bg-primary/85 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New persona
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-40 border border-border rounded-md-m" />
          ))}
        </div>
      ) : (personas as Persona[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-4">
            <UserCircle className="w-8 h-8 text-accent" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">No personas yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            A persona is who you sell to, saved as Prospect Search filters. Make one yourself, or have the AI draft a few from your website.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {draftButton}
            <Link
              to="/collection/personas/new"
              className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md-s font-medium hover:bg-primary/85 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Create persona
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {(personas as Persona[]).map(persona => (
            <div
              key={persona.id}
              className="card border border-border rounded-md-m p-6 flex flex-col gap-4 relative group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-foreground truncate">{persona.name}</h3>
                  {persona.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{persona.description}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Link
                    to="/collection/personas/$personaId"
                    params={{ personaId: persona.id }}
                    className="p-1.5 rounded-md-s text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Link>
                  <button
                    onClick={() => confirmDelete(persona)}
                    className="p-1.5 rounded-md-s text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {persona.criteria.titles.slice(0, 3).map(t => (
                  <Badge key={t} variant="default">{t}</Badge>
                ))}
                {persona.criteria.industries.slice(0, 2).map(i => (
                  <Badge key={i} variant="info">{i}</Badge>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">{criteriaSummary(persona.criteria)}</p>

              <div className="border-t border-border pt-3">
                <PersonaResults persona={persona} stats={stats[persona.id]} />
              </div>

              <button
                onClick={() => useInSearch(persona)}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium border border-accent/30 text-accent rounded-md-s hover:bg-accent/10 transition-colors cursor-pointer mt-auto"
              >
                Use in Prospect Search
              </button>
            </div>
          ))}
        </div>
      )}
      {draftStatus && <DraftPersonasDialog isOpen={drafting} onClose={() => setDrafting(false)} websiteUrl={draftStatus.websiteUrl} ai={draftStatus.ai} />}
    </div>
  )
}
