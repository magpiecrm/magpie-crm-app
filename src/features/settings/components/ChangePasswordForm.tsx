import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { changePasswordFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SettingsActions, SettingsBlock } from './SettingsBlock'

/** Settings → Team and login: change your own password. Signs you out on other devices. */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const mismatch = confirm.length > 0 && next !== confirm
  const canSubmit = current.length > 0 && next.trim().length >= 6 && next === confirm && !busy

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await changePasswordFn({ data: { currentPassword: current, newPassword: next } })
      if (res.success) {
        setCurrent('')
        setNext('')
        setConfirm('')
        setMessage({ ok: true, text: 'Password changed. You were signed out on your other devices.' })
      } else {
        setMessage({ ok: false, text: res.error || 'Failed to change password' })
      }
    } catch (err: any) {
      setMessage({ ok: false, text: err?.message || 'Failed to change password' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsBlock title="Your password" description="Changing it signs you out on your other devices.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <FieldGrid cols={3}>
          <Field label="Current">
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} className={INPUT_CLASS} />
          </Field>
          <Field label="New">
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 6 characters" disabled={busy} className={INPUT_CLASS} />
          </Field>
          <Field label="Confirm new" error={mismatch ? "Doesn't match the new password." : undefined}>
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} className={INPUT_CLASS} />
          </Field>
        </FieldGrid>
        {message && <Notice level={message.ok ? 'success' : 'error'}>{message.text}</Notice>}
        <SettingsActions>
          <Button type="submit" disabled={!canSubmit} isLoading={busy} leftIcon={<KeyRound className="w-4 h-4" />}>
            Change password
          </Button>
        </SettingsActions>
      </form>
    </SettingsBlock>
  )
}
