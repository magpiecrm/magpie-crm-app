import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Notice } from '../../../components/ui/Notice'
import { StarterTiles } from '../../../features/surveys/components/StarterTiles'
import { useCreateSurvey } from '../../../features/surveys/useCreateSurvey'

export const Route = createFileRoute('/marketing/surveys/new')({
  component: NewSurveyPage,
})

/** Where a new survey starts: one of a few common surveys, or a blank one. */
function NewSurveyPage() {
  const { pick, pending, error } = useCreateSurvey()
  return (
    <div className="w-full p-4 lg:p-8">
      <div className="mx-auto w-full max-w-6xl">
        <Link to="/marketing/surveys" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Surveys
        </Link>
        <h1 className="mb-1.5 text-2xl font-display text-foreground">New survey</h1>
        <p className="mb-6 text-muted-foreground">Start from one of these and change anything in the builder, or start blank.</p>
        {error && <Notice level="error" className="mb-4">{error}</Notice>}
        <StarterTiles onPick={pick} pending={pending} />
      </div>
    </div>
  )
}
