import { Link } from '@tanstack/react-router'
import { Badge } from '../../../components/ui/Badge'
import { Section } from '../../../components/ui/RecordSection'
import { formatWhen } from '../record'

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

/** The surveys a contact answered, each with their answers. */
export function ContactSurveysTab({ responses }: { responses: ContactSurveyResponse[] }) {
  return (
    <Section title="Survey answers" count={responses.length || undefined}>
      {responses.length === 0 ? (
        <p className="text-sm text-muted-foreground">They haven’t answered any surveys yet.</p>
      ) : (
        <ul className="-mt-1 divide-y divide-border">
          {responses.map((r) => (
            <li key={r.id} className="py-4 first:pt-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link to="/marketing/surveys/$surveyId" params={{ surveyId: r.surveyId }} className="text-sm font-medium text-foreground hover:text-accent">
                    {r.surveyName}
                  </Link>
                  <p className="text-[13px] text-muted-foreground">
                    {formatWhen(r.completedAt ?? r.startedAt)}
                    {r.source === 'email_inline' && ' · answered in an email'}
                  </p>
                </div>
                <Badge variant={r.status === 'completed' ? 'success' : 'default'}>{r.status === 'completed' ? 'Completed' : 'Not finished'}</Badge>
              </div>
              <dl className="mt-3 space-y-3">
                {r.answers.map((a, i) => (
                  <div key={i}>
                    <dt className="text-[13px] text-muted-foreground">{a.question}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{a.answer || <span className="text-muted-foreground">No answer</span>}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
