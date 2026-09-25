import { db } from './db'
import { sendMail } from './nodemailer'
import { pollBounces } from './bouncePoller'

// Use globalThis so the flag and interval survive Vite HMR module disposal.
// Without this, every file save in dev kills the setInterval and emails stop sending.
const g = globalThis as any

export function startEmailScheduler() {
  if (g.__emailSchedulerStarted) return
  g.__emailSchedulerStarted = true

  g.__emailSchedulerInterval = setInterval(async () => {
    const due = db.getDuePendingEmails()
    for (const e of due) {
      try {
        await sendMail({ to: e.contact_email, subject: e.subject, html: e.html, from: e.from })
        db.markPendingEmailSent(e.id)
        console.log(`[EmailScheduler] Sent welcome email to ${e.contact_email}`)
      } catch (err) {
        console.error(`[EmailScheduler] Failed to send to ${e.contact_email}:`, err)
      }
    }
  }, 60_000)

  g.__bouncePollerInterval = setInterval(() => {
    pollBounces().catch((err) => console.error('[BouncePoller] Poll failed:', err))
  }, 5 * 60_000)
  pollBounces().catch((err) => console.error('[BouncePoller] Poll failed:', err))

  console.log('[EmailScheduler] Started — checking every 60s (bounce poll every 5m)')
}
