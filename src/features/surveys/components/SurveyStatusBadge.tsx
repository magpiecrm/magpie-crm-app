import { Badge } from '../../../components/ui/Badge'
import type { SurveyStatus } from '../../survey-builder/types'

const VARIANTS: Record<SurveyStatus, { label: string; variant: 'default' | 'success' | 'warning' }> = {
  draft: { label: 'Draft', variant: 'default' },
  published: { label: 'Live', variant: 'success' },
  closed: { label: 'Closed', variant: 'warning' },
}

export function SurveyStatusBadge({ status }: { status: SurveyStatus }) {
  const { label, variant } = VARIANTS[status]
  return <Badge variant={variant}>{label}</Badge>
}
