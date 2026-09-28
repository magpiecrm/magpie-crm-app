import { db } from './db'
import { sendMail } from './nodemailer'
import { pollBounces } from './bouncePoller'
import { notify } from './notify'
import { sendCampaign, settleHeldGuesses } from './emailService'
import { refreshHostRules } from './prospecting/hostRules'
import { reportFormats } from './prospecting/sharedFormats'

// Use globalThis so the flag and interval survive Vite HMR module disposal.
// Without this, every file save in dev kills the setInterval and emails stop sending.
const g = globalThis as any

/**
 * Sends scheduled campaigns once their time has come (checked every minute,
 * so within a minute of it, or straight after a restart if the server was
 * down then). One at a time, and never two runs at once.
 */
export async function sendDueCampaigns(now = new Date()) {
  if (g.__campaignRunBusy) return
  g.__campaignRunBusy = true
  try {
    for (const id of db.dueScheduledCampaigns(now)) {
      const name = db.data.campaigns.find((c) => c.id === id)?.name ?? `#${id}`
      try {
        await sendCampaign(id)
        console.log(`[EmailScheduler] Sent scheduled campaign ${id}`)
      } catch (err: any) {
        // Someone pressed Send at the same moment: theirs is the send, nothing failed.
        const status = db.data.campaigns.find((c) => c.id === id)?.status
        if (status === 'sending' || status === 'sent') continue
        // Not retried every minute: it goes back to a draft and the user is told why.
        db.releaseCampaign(id)
        console.error(`[EmailScheduler] Scheduled campaign ${id} failed:`, err?.message ?? err)
        notify('campaign_failed', `"${name}" didn't send at its scheduled time: ${err?.message ?? 'unknown error'}`, {
          url: `/marketing/campaigns/${id}`,
        })
      }
    }
    // Unverified addresses held back after a first batch (guessedRecipients.ts).
    await settleHeldGuesses(now)
  } finally {
    g.__campaignRunBusy = false
  }
}

/** Finishes campaigns the server stopped in the middle of sending; everyone they reached is skipped. */
async function resumeInterruptedSends() {
  for (const id of db.campaignsLeftSending()) {
    try {
      await sendCampaign(id, { resume: true })
      console.log(`[EmailScheduler] Finished sending campaign ${id} after a restart`)
    } catch (err: any) {
      db.releaseCampaign(id)
      console.error(`[EmailScheduler] Couldn't finish campaign ${id}:`, err?.message ?? err)
    }
  }
}

export function startEmailScheduler() {
  if (g.__emailSchedulerStarted) return
  g.__emailSchedulerStarted = true

  // Nothing else is sending yet at start-up, so any campaign still 'sending'
  // was cut off by a restart.
  resumeInterruptedSends()
    .catch((err) => console.error('[EmailScheduler] Resume failed:', err))
    .finally(() => sendDueCampaigns().catch((err) => console.error('[EmailScheduler] Scheduled sends failed:', err)))

  g.__emailSchedulerInterval = setInterval(async () => {
    sendDueCampaigns().catch((err) => console.error('[EmailScheduler] Scheduled sends failed:', err))
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

  // A hosted copy's rules for unverifiable addresses (prospecting/hostRules.ts),
  // and its company email formats reported for sharing (sharedFormats.ts).
  const refreshRules = () => refreshHostRules().catch((err) => console.error('[HostRules] Refresh failed:', err))
  refreshRules()
  g.__hostRulesInterval = setInterval(refreshRules, 10 * 60_000)
  const shareFormats = () =>
    reportFormats(db.allKnownAddresses())
      .then((n) => n && console.log(`[SharedFormats] Reported formats at ${n} companies`))
      .catch((err) => console.error('[SharedFormats] Report failed:', err))
  g.__shareFormatsTimeout = setTimeout(shareFormats, 2 * 60_000)
  g.__shareFormatsInterval = setInterval(shareFormats, 6 * 60 * 60_000)

  g.__bouncePollerInterval = setInterval(() => {
    pollBounces().catch((err) => console.error('[BouncePoller] Poll failed:', err))
  }, 5 * 60_000)
  pollBounces().catch((err) => console.error('[BouncePoller] Poll failed:', err))

  console.log('[EmailScheduler] Started — checking every 60s (bounce poll every 5m)')
}
