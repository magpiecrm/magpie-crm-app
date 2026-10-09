import { db } from './db'
import { sendMail } from './nodemailer'
import { pollBounces } from './bouncePoller'
import { notify } from './notify'
import { sendCampaign, settleHeldGuesses } from './emailService'
import { refreshHostRules } from './prospecting/hostRules'
import { reportFormats } from './prospecting/sharedFormats'
import { contributeSaved } from './prospecting/sharedPeople'
import { getAppUrl } from './appUrl'
import { encryptToken } from './crypto'

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

/** Reads connected inboxes for replies (mailboxes/); never two reads at once. */
async function pollDueMailboxes() {
  if (g.__mailboxPollBusy) return
  g.__mailboxPollBusy = true
  try {
    const { pollMailboxes } = await import('./mailboxes')
    await pollMailboxes()
  } catch (err) {
    console.error('[EmailScheduler] Reading inboxes failed:', err)
  } finally {
    g.__mailboxPollBusy = false
  }
}

/** Sequence emails that are due (sequences/engine.ts); never two runs at once. */
async function runDueSequences() {
  if (g.__sequenceRunBusy) return
  g.__sequenceRunBusy = true
  try {
    const { runSequences } = await import('./sequences/engine')
    await runSequences()
  } finally {
    g.__sequenceRunBusy = false
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

/** A welcome email's unsubscribe link: where the design asks for it ({{ unsubscribe }}), else at the bottom. */
export function withUnsubscribeLink(html: string, url: string): string {
  const replaced = html.replace(/\{\{\s*unsubscribe\s*\}\}/gi, url)
  if (replaced.includes(url)) return replaced
  const footer = `<div style="text-align:center;margin-top:30px;font-size:12px;color:#666">Don't want these emails? <a href="${url}" style="color:#666;text-decoration:underline">Unsubscribe</a></div>`
  return /<\/body>/i.test(replaced) ? replaced.replace(/<\/body>/i, (m) => `${footer}${m}`) : replaced + footer
}

export function startEmailScheduler() {
  if (g.__emailSchedulerStarted) return
  g.__emailSchedulerStarted = true

  // Nothing else is sending yet at start-up, so any campaign still 'sending'
  // was cut off by a restart.
  resumeInterruptedSends()
    .catch((err) => console.error('[EmailScheduler] Resume failed:', err))
    .finally(() => sendDueCampaigns().catch((err) => console.error('[EmailScheduler] Scheduled sends failed:', err)))

  // Senders' connected inboxes, read for replies to sequence emails (mailboxes/): every
  // 3 minutes, and soon after starting, so follow-ups held for a fresh read aren't held long.
  clearInterval(g.__mailboxPollInterval)
  g.__mailboxPollInterval = setInterval(() => void pollDueMailboxes(), 3 * 60_000)
  setTimeout(() => void pollDueMailboxes(), 30_000)

  // A sequence email claimed but not committed was cut off by a restart: taken as sent, never sent twice.
  import('./sequences/engine').then(({ recoverClaims }) => recoverClaims()).catch((err) => console.error('[EmailScheduler] Sequence recovery failed:', err))

  g.__emailSchedulerInterval = setInterval(async () => {
    sendDueCampaigns().catch((err) => console.error('[EmailScheduler] Scheduled sends failed:', err))
    runDueSequences().catch((err) => console.error('[EmailScheduler] Sequences failed:', err))
    remindDueTasks().catch((err) => console.error('[EmailScheduler] Task reminders failed:', err))
    const due = db.getDuePendingEmails()
    for (const e of due) {
      // Unsubscribed or bounced since they signed up: not sent.
      const contact = db.getContact(e.contact_email)
      if (!contact || contact.status !== 'subscribed' || db.emailStop(e.contact_email)) {
        db.markPendingEmailSent(e.id, 'skipped')
        console.log(`[EmailScheduler] Skipped the welcome email to ${e.contact_email}: no longer subscribed`)
        continue
      }
      try {
        const unsubscribeUrl = `${await getAppUrl()}/api/unsubscribe?t=${encodeURIComponent(encryptToken({ email: e.contact_email }))}`
        await sendMail({ to: e.contact_email, subject: e.subject, html: withUnsubscribeLink(e.html, unsubscribeUrl), from: e.from, unsubscribeUrl })
        db.markPendingEmailSent(e.id)
        console.log(`[EmailScheduler] Sent welcome email to ${e.contact_email}`)
      } catch (err) {
        const gaveUp = db.notePendingEmailFailure(e.id)
        console.error(`[EmailScheduler] Failed to send to ${e.contact_email}${gaveUp ? ' (giving up after 5 tries)' : ''}:`, err)
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
  // Where this copy contributes to its host's shared database: the contacts it saved before joining.
  const offerSaved = () =>
    contributeSaved(db)
      .then((n) => n && console.log(`[SharedPeople] The host took ${n} contacts saved before joining`))
      .catch((err) => console.error('[SharedPeople] Offering saved contacts failed:', err))
  g.__sharedPeopleTimeout = setTimeout(offerSaved, 3 * 60_000)
  g.__sharedPeopleInterval = setInterval(offerSaved, 6 * 60 * 60_000)

  g.__bouncePollerInterval = setInterval(() => {
    pollBounces().catch((err) => console.error('[BouncePoller] Poll failed:', err))
  }, 5 * 60_000)
  pollBounces().catch((err) => console.error('[BouncePoller] Poll failed:', err))

  console.log('[EmailScheduler] Started — checking every 60s (bounce poll every 5m)')
}

/** A reminder (in-app, and a push to subscribed devices) for each task now due, once. */
async function remindDueTasks() {
  const { sales } = await import('./sales')
  const { notify } = await import('./notify')
  for (const task of sales.takeDueReminders()) {
    const about = task.deal_name ?? task.contact_name ?? task.company_name
    notify('task_due', `Due now: ${task.body}${about ? ` (${about})` : ''}`, { url: task.link, contactEmail: task.contact_email ?? undefined })
  }
}
