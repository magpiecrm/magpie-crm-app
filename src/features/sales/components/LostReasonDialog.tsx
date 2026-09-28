import { useEffect, useState } from 'react'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { FIELD_CLASS } from '../forms'

/** Asks why a deal was lost before it moves to Lost. The reason is optional. */
export function LostReasonDialog({
  dealName,
  isOpen,
  onCancel,
  onConfirm,
  isSaving = false,
}: {
  dealName?: string
  isOpen: boolean
  onCancel: () => void
  onConfirm: (reason: string | null) => void
  isSaving?: boolean
}) {
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (isOpen) setReason('')
  }, [isOpen])

  return (
    <Dialog isOpen={isOpen} onClose={onCancel} title="Mark as lost" className="max-w-md">
      <form
        className="p-4 sm:p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(reason.trim() || null)
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-sm text-foreground">
            Why was {dealName ? <strong className="font-semibold">{dealName}</strong> : 'this deal'} lost?{' '}
            <span className="text-muted-foreground">(optional)</span>
          </span>
          <textarea
            autoFocus
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="For example: went with a competitor"
            className={`${FIELD_CLASS} resize-y`}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" isLoading={isSaving}>
            Mark as lost
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
