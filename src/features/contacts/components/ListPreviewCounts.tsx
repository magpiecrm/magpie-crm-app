import { Notice } from '../../../components/ui/Notice'
import type { ListPreview } from '../../../server/listBuilder'
import { SKIP_REASONS } from '../../sequences/components/labels'

const count = (n: number) => n.toLocaleString('en-GB')

/** Who adding these people would reach, who sends would leave out and why. */
export function WhoCanBeEmailed({ preview }: { preview: ListPreview }) {
  const left = Object.entries(preview.wontEmail).filter(([, n]) => n > 0)
  return (
    <div className="space-y-1 text-sm">
      <p className="text-foreground">{count(preview.canEmail)} can be emailed.</p>
      {left.map(([reason, n]) => (
        <p key={reason} className="text-muted-foreground">
          {count(n)} won't be: they {SKIP_REASONS[reason]}.
        </p>
      ))}
    </div>
  )
}

/** What's worth knowing about a selection before relying on it. */
export function SelectionNotes({ preview }: { preview: ListPreview }) {
  return (
    <>
      {preview.everyone && (
        <Notice level="warning" title="This is every contact">
          These filters leave nobody out. Check that's what you meant.
        </Notice>
      )}
      {preview.blanks.map((b) => (
        <Notice key={`${b.label}${b.included}`}>
          {b.included
            ? `${count(b.count)} ${b.count === 1 ? 'is' : 'are'} included only because they have no ${b.label}. Add "${b.label} has a value" to leave them out.`
            : `${count(b.count)} ${b.count === 1 ? 'contact has' : 'contacts have'} no ${b.label}, so can't match this.`}
        </Notice>
      ))}
    </>
  )
}
