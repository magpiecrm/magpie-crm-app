import { db, type NotificationType } from './db'
import { sendPushToAll } from './push'
import { APP_NAME } from '../brand'

/** Where tapping each kind of notification should land. */
const DEFAULT_URLS: Record<NotificationType, string> = {
  contact_added: '/marketing/contacts',
  form_submission: '/marketing/forms',
  campaign_sent: '/marketing/campaigns',
  campaign_failed: '/marketing/campaigns',
  survey_response: '/marketing/surveys',
  verifier_alert: '/settings?tab=prospecting',
  task_due: '/sales/tasks',
  proposal_viewed: '/sales/deals',
  proposal_accepted: '/sales/deals',
  sequence_paused: '/sales/sequences',
  sequence_reply: '/sales/sequences',
}

/**
 * Record an in-app notification and push it to subscribed devices.
 *
 * Use this instead of calling `db.addNotification` directly, so the bell and
 * the phone never disagree. Lives outside `db.ts` because `push.ts` reads
 * subscriptions back out of `db` — wiring it into the db module would make
 * that import cycle.
 */
export function notify(
  type: NotificationType,
  message: string,
  opts: { url?: string; contactEmail?: string } = {},
): void {
  db.addNotification(type, message, opts.contactEmail)

  // Fire and forget: a push failure must never fail the request that caused it.
  sendPushToAll({
    title: APP_NAME,
    body: message,
    url: opts.url ?? DEFAULT_URLS[type],
    tag: type,
  }).catch((err) => console.error('[Push] send failed:', err))
}
