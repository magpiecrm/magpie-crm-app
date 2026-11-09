import { useEffect, useState } from 'react'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Field } from '../../../components/ui/Field'
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
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title={dealName ? `Mark “${dealName}” as lost?` : 'Mark as lost?'}
      description="The deal moves to Lost. Saying why helps you spot patterns later."
      className="sm:max-w-md"
    >
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(reason.trim() || null)
        }}
      >
        <DialogBody>
          <Field label={<>Why was it lost? <span className="font-normal text-muted-foreground">(optional)</span></>}>
            <textarea
              autoFocus
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Went with a competitor"
              className={`${FIELD_CLASS} resize-none`}
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" isLoading={isSaving}>
            Mark as lost
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
