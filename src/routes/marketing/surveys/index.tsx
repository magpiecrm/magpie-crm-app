import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ArrowLeft, BarChart3, ClipboardList, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { createSurveyFn, deleteSurveyFn, duplicateSurveyFn, getSurveysFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { SURVEY_STARTER_TEMPLATES } from '../../../features/survey-builder/templates/starters'
import { SurveyStatusBadge } from '../../../features/surveys/components/SurveyStatusBadge'

export const Route = createFileRoute('/marketing/surveys/')({
  component: SurveysPage,
})

type SurveySummaryRow = Awaited<ReturnType<typeof getSurveysFn>>[number]

function SurveysPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)

  const { data: surveys = [], isLoading } = useQuery({
    queryKey: queryKeys.surveys.list(),
    queryFn: () => getSurveysFn(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.surveys.list() })

  const openBuilder = (id: string) => navigate({ to: '/marketing/surveys/$surveyId/edit', params: { surveyId: id } })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; templateId: string }) => createSurveyFn({ data }),
    onSuccess: survey => {
      invalidate()
      setShowCreate(false)
      openBuilder(survey.id)
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateSurveyFn({ data: { id } }),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSurveyFn({ data: { id } }),
    onSuccess: invalidate,
  })

  const confirmDelete = (survey: SurveySummaryRow) => {
    const warning = survey.responseCount ? ` Its ${survey.responseCount} response(s) will be deleted too.` : ''
    if (confirm(`Delete "${survey.name}"?${warning} This cannot be undone.`)) deleteMutation.mutate(survey.id)
  }

  // Take over the page rather than opening a modal, as the Forms builder does.
  if (showCreate) {
    return (
      <CreateSurveyView
        onClose={() => setShowCreate(false)}
        onCreate={data => createMutation.mutate(data)}
        isSaving={createMutation.isPending}
        error={createMutation.error?.message}
      />
    )
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="flex justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-display text-foreground mb-2">Surveys</h1>
          <p className="text-muted-foreground">
            Build surveys, send them by email or embed them, and feed answers back to contact profiles.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-primary text-primary-foreground px-6 py-2.5 rounded-md-s font-medium hover:bg-primary/85 active:scale-95 transition-all flex items-center gap-2 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          New Survey
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-6 animate-pulse h-40 border border-border rounded-md-m" />
          ))}
        </div>
      ) : surveys.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-4">
            <ClipboardList className="w-8 h-8 text-accent" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">No surveys yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">Start from a template such as NPS or customer satisfaction.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md-s font-medium hover:bg-primary/85 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Create Survey
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {surveys.map(survey => {
            const rate = survey.responseCount ? Math.round((survey.completedCount / survey.responseCount) * 100) : null
            return (
              <div
                key={survey.id}
                className="card border border-border rounded-md-m p-6 flex flex-col gap-4 cursor-pointer hover:border-accent/50 transition-colors"
                onClick={() => navigate({ to: '/marketing/surveys/$surveyId', params: { surveyId: survey.id } })}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-foreground truncate">{survey.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {survey.pageCount} page{survey.pageCount !== 1 ? 's' : ''} · updated {new Date(survey.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <IconButton title="Edit" onClick={() => openBuilder(survey.id)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton title="Duplicate" onClick={() => duplicateMutation.mutate(survey.id)}>
                      <Copy className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton title="Delete" danger onClick={() => confirmDelete(survey)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <SurveyStatusBadge status={survey.status} />
                  {rate !== null && <Badge>{rate}% completion</Badge>}
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-auto">
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span>
                    <span className="font-semibold text-foreground">{survey.completedCount}</span> completed ·{' '}
                    {survey.responseCount} started
                  </span>
                  {survey.lastResponseAt && (
                    <span className="ml-auto">last {new Date(survey.lastResponseAt).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}

function IconButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      onClick={e => {
        e.stopPropagation()
        onClick()
      }}
      className={`p-1.5 rounded-md-s text-muted-foreground transition-colors cursor-pointer ${
        danger ? 'hover:text-destructive hover:bg-destructive/10' : 'hover:text-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}

function CreateSurveyView({
  onClose,
  onCreate,
  isSaving,
  error,
}: {
  onClose: () => void
  onCreate: (data: { name: string; templateId: string }) => void
  isSaving: boolean
  error?: string
}) {
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('blank')
  const categories = [...new Set(SURVEY_STARTER_TEMPLATES.map(t => t.category))]

  return (
    <form
      className="p-4 lg:p-8 max-w-5xl"
      onSubmit={e => {
        e.preventDefault()
        const template = SURVEY_STARTER_TEMPLATES.find(t => t.id === templateId)
        onCreate({ name: name.trim() || template?.name || 'Untitled survey', templateId })
      }}
    >
      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to surveys"
          className="p-2 rounded-md-s hover:bg-muted text-muted-foreground cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-display text-foreground">New survey</h1>
          <p className="text-muted-foreground text-sm">Name it and pick a starting point. You can change everything in the builder.</p>
        </div>
      </div>

      <div className="space-y-8">
        <label className="flex flex-col gap-1.5 text-sm max-w-md">
          <span className="font-medium text-foreground">Name</span>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Q3 customer feedback"
            className="w-full bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        {categories.map(category => (
          <div key={category} className="space-y-3">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{category}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {SURVEY_STARTER_TEMPLATES.filter(t => t.category === category).map(t => {
                const pages = t.build()
                const questions = pages.flatMap(p => p.blocks.filter(b => b.question))
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setTemplateId(t.id)}
                    onDoubleClick={() => onCreate({ name: name.trim() || t.name, templateId: t.id })}
                    className={`card text-left p-5 rounded-md-m border transition-colors cursor-pointer flex flex-col gap-2 ${
                      templateId === t.id ? 'border-accent ring-1 ring-accent bg-accent/5' : 'border-border hover:border-accent/50'
                    }`}
                  >
                    <div className="font-medium text-foreground">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.description}</div>
                    <div className="text-[11px] text-muted-foreground mt-auto pt-2">
                      {pages.length} page{pages.length !== 1 ? 's' : ''} · {questions.length} question{questions.length !== 1 ? 's' : ''}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-6">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md-s border border-border hover:bg-muted cursor-pointer">
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-md-s text-sm font-medium hover:bg-primary/85 disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? 'Creating…' : 'Create & open builder'}
          </button>
        </div>
      </div>
    </form>
  )
}
