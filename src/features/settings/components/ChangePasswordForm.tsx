import { useState } from 'react'
import { AlertCircle, Check, KeyRound, RefreshCw } from 'lucide-react'
import { changePasswordFn } from '../../../server/functions'

const inputClass =
  'bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50'

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
    <form onSubmit={submit} className="flex flex-col gap-3 p-5 bg-muted/20 border border-border/80 rounded-md-s">
      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Change Your Password</h4>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current-password" className="text-xs font-semibold text-foreground">Current password</label>
          <input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} disabled={busy} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className="text-xs font-semibold text-foreground">New password</label>
          <input id="new-password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 6 characters" disabled={busy} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-password" className="text-xs font-semibold text-foreground">Confirm new password</label>
          <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} className={inputClass} />
          {mismatch && <span className="text-xs text-destructive">Doesn't match the new password.</span>}
        </div>
      </div>
      {message && (
        <div
          className={`p-3 text-sm rounded-md-s flex items-start gap-2 border ${
            message.ok ? 'bg-green-500/10 border-green-500/20 text-green-500' : 'bg-destructive/10 border-destructive/20 text-destructive'
          }`}
        >
          {message.ok ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{message.text}</span>
        </div>
      )}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full md:w-auto md:self-end px-4 py-2.5 bg-primary hover:bg-primary/85 disabled:opacity-50 text-primary-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
      >
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        <span>Change Password</span>
      </button>
    </form>
  )
}
