import { Link } from '@tanstack/react-router'
import { ClipboardList } from 'lucide-react'
import { Badge } from '../../../components/ui/Badge'

export interface ContactSurveyResponse {
  id: string
  surveyId: string
  surveyName: string
  status: 'partial' | 'completed'
  source: string
  startedAt: string
  completedAt: string | null
  answers: Array<{ question: string; answer: string }>
}

export function ContactSurveysTab({ responses }: { responses: ContactSurveyResponse[] }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <ClipboardList className="w-5 h-5 text-accent" />
        <h3 className="font-bold text-foreground">Survey responses</h3>
      </div>
      {responses.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">This contact hasn't answered any surveys yet.</div>
      ) : (
        <div className="space-y-4">
          {responses.map(r => (
            <div key={r.id} className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link to="/marketing/surveys/$surveyId" params={{ surveyId: r.surveyId }} className="font-semibold text-sm text-foreground hover:text-accent">
                    {r.surveyName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.completedAt ?? r.startedAt).toLocaleString()}
                    {r.source === 'email_inline' && ' · answered in email'}
                  </p>
                </div>
                <Badge variant={r.status === 'completed' ? 'success' : 'default'}>{r.status === 'completed' ? 'Completed' : 'Partial'}</Badge>
              </div>
              <dl className="space-y-2">
                {r.answers.map((a, i) => (
                  <div key={i}>
                    <dt className="text-[11px] font-medium text-muted-foreground">{a.question}</dt>
                    <dd className="text-sm text-foreground whitespace-pre-wrap">{a.answer || '—'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
