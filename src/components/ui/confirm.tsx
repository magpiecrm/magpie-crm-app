import React, { useRef, useSyncExternalStore } from 'react'
import { Dialog } from './Dialog'
import { Button } from './Button'

export interface ConfirmOptions {
  /** The question, naming the thing: `Delete “Q1 webinar”?` */
  title: string
  /** What happens if they go ahead, in a sentence or two. */
  message?: React.ReactNode
  /** The button that goes ahead, as a verb and object: “Delete campaign”. */
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` for what can't be undone (a red button, Cancel focused first); `warning` for a risk worth a second look. */
  tone?: 'default' | 'danger' | 'warning'
}

type Request = ConfirmOptions & { resolve: (ok: boolean) => void }

let current: Request | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * Asks before something happens, in the app's own dialog instead of the
 * browser's `confirm()`. Resolves true if they go ahead. One at a time: a new
 * question answers the one before it with false.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  current?.resolve(false)
  return new Promise((resolve) => {
    current = { ...options, resolve }
    emit()
  })
}

function answer(ok: boolean) {
  const request = current
  current = null
  emit()
  request?.resolve(ok)
}

/** Shows the questions `confirmDialog` asks. Mounted once, in the app's layout. */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribe, () => current, () => null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Kept while the dialog closes, so its text doesn't blank out under the fade.
  const shown = useRef<Request | null>(null)
  if (request) shown.current = request
  const r = request ?? shown.current
  const tone = r?.tone ?? 'default'

  return (
    <Dialog
      isOpen={!!request}
      onClose={() => answer(false)}
      role="alertdialog"
      className="sm:max-w-md"
      title={r?.title}
      description={r?.message}
      initialFocus={tone === 'danger' ? cancelRef : confirmRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => answer(false)}>
            {r?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button ref={confirmRef} variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => answer(true)}>
            {r?.confirmLabel ?? 'Continue'}
          </Button>
        </>
      }
    />
  )
}
