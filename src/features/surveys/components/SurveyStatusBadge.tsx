import type { SurveyStatus } from '../../survey-builder/types'

/**
 * Whether a survey takes responses: a dot and a word, so it doesn't rest on
 * colour. Drawn like the Forms pages' status (`FormStatus`): live is green, a
 * draft an open ring, closed a grey dot.
 */
const LOOK: Record<SurveyStatus, { label: string; pill: string; dot: string }> = {
  published: {
    label: 'Live',
    pill: 'bg-emerald-500/12 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
  },
  draft: {
    label: 'Draft',
    pill: 'bg-foreground/[0.07] text-foreground/80',
    dot: 'border-[1.5px] border-foreground/55 bg-transparent',
  },
  closed: {
    label: 'Closed',
    pill: 'bg-foreground/[0.07] text-foreground/80',
    dot: 'bg-foreground/45',
  },
}

export function SurveyStatusBadge({ status }: { status: SurveyStatus }) {
  const { label, pill, dot } = LOOK[status]
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${pill}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  )
}
