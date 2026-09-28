import { db, type RecipientRecord } from './db'
import { sendMail } from './nodemailer'
import { encryptToken } from './crypto'
import { notify } from './notify'
import { getAppUrl } from './appUrl'
import { normalizeHref } from '../features/email-builder/utils/html'
import { expandSurveyPlaceholders, referencedSurveyIds } from './surveyLinks'
import { formatCustomValue } from '../features/contacts/contactFields'
import { AllowanceError, requireAllowance } from './allowance'
import { requireSendingDomain } from './sendingDomains'
import { env } from './env'
import { optedOutAt, signedUpSince } from './prospecting/suppression'

/** `{{ contact.custom.<key> }}` — a custom contact field value. */
const CUSTOM_FIELD_TAG = /\{\{\s*contact\.custom\.([a-z0-9_]+)\s*\}\}/gi

/**
 * Make every `href` in a stored campaign absolute.
 *
 * The compiler normalizes on the way out, but campaigns saved before it did
 * still hold schemeless hrefs like `www.example.com`. Those are relative URLs:
 * clients refuse to linkify them, and a tracked click would 302 to
 * `Location: www.example.com`, which resolves against our own domain.
 */
function absolutizeHrefs(html: string): string {
  // `v:roundrect` is the Outlook half of a bulletproof button, which carries its
  // own href and would otherwise keep the broken URL for Word-engine clients.
  return html.replace(
    /(<(?:a|v:roundrect)\s+[^>]*?href=")([^"]*)(")/gi,
    (_m, before: string, href: string, after: string) => `${before}${normalizeHref(href)}${after}`,
  )
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
      default: return m;
    }
  });
}

function injectPreviewText(html: string, previewText?: string): string {
  if (!previewText) return html

  const escapedPreview = escapeHtml(previewText)
  const padding = '&nbsp;&zwnj;'.repeat(100)
  const preheader = `<div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; opacity: 0; mso-hide: all;">${escapedPreview}${padding}</div>`

  const bodyRegex = /<body([^>]*)>/i
  if (bodyRegex.test(html)) {
    return html.replace(bodyRegex, (match) => `${match}${preheader}`)
  }
  return `${preheader}${html}`
}

export interface EmailContact {
  email: string
  attributes?: {
    FIRSTNAME?: string
    LASTNAME?: string
    JOB_TITLE?: string
    COMPANY?: string
  }
}

// --- Lists ---

export async function getLists() {
  const lists = db.query(`
    SELECT l.id, l.name, l.created_at as createdAt, COUNT(lc.contact_email) as totalContacts
    FROM lists l
    LEFT JOIN list_contacts lc ON l.id = lc.list_id
    GROUP BY l.id
    ORDER BY l.id DESC
  `).all() as any[]

  return { lists, count: lists.length }
}

export async function getContacts(limit?: number, offset?: number) {
  let query = 'SELECT email, first_name, last_name, job_title, company, status, created_at FROM contacts'
  const params: any[] = []

  if (limit !== undefined) {
    query += ' LIMIT ? OFFSET ?'
    params.push(limit, offset || 0)
  }

  const rows = db.query(query).all(...params) as any[]
  const contacts = rows.map(r => ({
    email: r.email,
    status: r.status,
    createdAt: r.created_at,
    attributes: {
      FIRSTNAME: r.first_name || '',
      LASTNAME: r.last_name || '',
      JOB_TITLE: r.job_title || '',
      COMPANY: r.company || '',
    },
    custom: r.custom ?? {},
  }))

  const totalCount = (db.query('SELECT COUNT(*) as count FROM contacts').get() as { count: number }).count

  return { contacts, count: totalCount }
}

export async function getListContacts(listId: number) {
  const rows = db.query(`
    SELECT c.email, c.first_name, c.last_name, c.job_title, c.company, c.status, c.created_at
    FROM contacts c
    JOIN list_contacts lc ON c.email = lc.contact_email
    WHERE lc.list_id = ?
  `).all(listId) as any[]

  const contacts = rows.map(r => ({
    email: r.email,
    status: r.status,
    createdAt: r.created_at,
    attributes: {
      FIRSTNAME: r.first_name || '',
      LASTNAME: r.last_name || '',
      JOB_TITLE: r.job_title || '',
      COMPANY: r.company || '',
    },
    custom: r.custom ?? {},
  }))

  return { contacts, count: contacts.length }
}

export async function createList(name: string) {
  db.run('INSERT INTO lists (name, created_at) VALUES (?, ?)', [name, new Date().toISOString()])
  const id = (db.query('SELECT last_insert_rowid() as id').get() as { id: number }).id
  return { id, name }
}

export async function removeContactFromList(listId: number, email: string) {
  db.run('DELETE FROM list_contacts WHERE list_id = ? AND contact_email = ?', [listId, email.toLowerCase().trim()])
}

export async function deleteList(listId: number) {
  db.run('DELETE FROM list_contacts WHERE list_id = ?', [listId])
  db.run('DELETE FROM lists WHERE id = ?', [listId])
}

/**
 * Adds contacts to a list, creating the ones that don't exist yet. New people
 * who opted out of being contacted through MagpieCRM (the suppression list)
 * are skipped rather than added; returns how many.
 */
export async function addContactsToList(listId: number, contacts: EmailContact[]): Promise<{ added: number; skipped: number }> {
  const known = new Set(db.data.contacts.map((c) => c.email))
  const optedOut = optedOutAt(
    db,
    contacts
      .map((c) => ({ email: c.email.toLowerCase().trim(), first_name: c.attributes?.FIRSTNAME, last_name: c.attributes?.LASTNAME }))
      .filter((c) => !known.has(c.email)),
  )
  const insertContactStmt = db.prepare(`
    INSERT OR REPLACE INTO contacts (email, first_name, last_name, job_title, company, status, created_at)
    VALUES (?, ?, ?, ?, ?, COALESCE((SELECT status FROM contacts WHERE email = ?), 'subscribed'), ?)
  `)

  const linkContactStmt = db.prepare(`
    INSERT OR IGNORE INTO list_contacts (list_id, contact_email)
    VALUES (?, ?)
  `)

  const now = new Date().toISOString()
  let added = 0
  db.transaction(() => {
    for (const c of contacts) {
      const email = c.email.toLowerCase().trim()
      if (optedOut.has(email)) continue
      added++
      const fn = c.attributes?.FIRSTNAME || ''
      const ln = c.attributes?.LASTNAME || ''
      const jt = c.attributes?.JOB_TITLE || ''
      const comp = c.attributes?.COMPANY || ''

      insertContactStmt.run(email, fn, ln, jt, comp, email, now)
      linkContactStmt.run(listId, email)
    }
  })()
  if (optedOut.size) console.log(`[Contacts] Skipped ${optedOut.size} who opted out of being contacted`)
  return { added, skipped: optedOut.size }
}

/**
 * Puts a contact back into the subscriber pool.
 *
 * Deliberately single-contact and explicit: every other write path
 * (createContact, addContactsToList, /api/subscribe) preserves an existing
 * status so a re-import cannot resurrect people who opted out. This is the one
 * place that overrides an unsubscribe, so it stays a one-at-a-time operator
 * action rather than anything bulk.
 *
 * Only `contacts.status` changes — list membership and campaign history are
 * left exactly as they are.
 */
export async function resubscribeContact(email: string) {
  const normalized = email.toLowerCase().trim()
  const contact = db.data.contacts.find((c) => c.email === normalized)

  if (!contact) {
    throw new Error(`No contact found with email ${normalized}`)
  }

  const previousStatus = contact.status
  if (previousStatus === 'subscribed') {
    return { success: true, previousStatus, changed: false }
  }

  db.run('UPDATE contacts SET status = ? WHERE email = ?', ['subscribed', normalized])

  // Consent changes are worth a trace, since nothing else records them.
  console.log(`[Contacts] Resubscribed ${normalized} (was "${previousStatus}")`)

  return { success: true, previousStatus, changed: true }
}

export async function createContact(payload: {
  email: string
  attributes?: Record<string, any>
  listIds?: number[]
}) {
  const email = payload.email.toLowerCase().trim()
  const fn = payload.attributes?.FIRSTNAME || ''
  const ln = payload.attributes?.LASTNAME || ''
  const jt = payload.attributes?.JOB_TITLE || ''
  const comp = payload.attributes?.COMPANY || ''
  const now = new Date().toISOString()
  const isNewContact = !db.data.contacts.some(c => c.email === email)
  if (isNewContact && optedOutAt(db, [{ email, first_name: fn, last_name: ln }]).size) {
    throw new Error(`${email} has opted out of being contacted through MagpieCRM, so they can't be added.`)
  }

  db.transaction(() => {
    db.run(
      `INSERT OR REPLACE INTO contacts (email, first_name, last_name, job_title, company, status, created_at)
       VALUES (?, ?, ?, ?, ?, COALESCE((SELECT status FROM contacts WHERE email = ?), 'subscribed'), ?)`,
      [email, fn, ln, jt, comp, email, now]
    )

    if (payload.listIds) {
      for (const listId of payload.listIds) {
        db.run('INSERT OR IGNORE INTO list_contacts (list_id, contact_email) VALUES (?, ?)', [listId, email])
      }
    }
  })()

  if (isNewContact) {
    notify('contact_added', `New contact added: ${email}`, { contactEmail: email })
  }

  return { email }
}

export async function deleteContacts(emails: string[]) {
  db.transaction(() => {
    for (const email of emails) {
      db.run('DELETE FROM contacts WHERE email = ?', [email])
    }
  })()
  return { success: true, count: emails.length }
}

// --- Campaigns ---

export async function getCampaigns() {
  const campaigns = db.query(`
    SELECT 
      c.id, c.name, c.subject, c.preview_text as previewText, 
      c.status, c.created_at as createdAt, c.sent_at as sentAt,
      c.list_id as listId, l.name as listName,
      s.name as senderName, s.email as senderEmail
    FROM campaigns c
    LEFT JOIN lists l ON c.list_id = l.id
    LEFT JOIN senders s ON c.sender_id = s.id
    ORDER BY c.id DESC
  `).all() as any[]

  // Campaign rows with their stats, in the shape the campaign pages read.
  const formatted = await Promise.all(campaigns.map(async c => {
    const stats = await getCampaignStats(c.id)
    return {
      id: c.id,
      name: c.name,
      subject: c.subject,
      previewText: c.previewText,
      status: c.status,
      unsubscribeEnabled: c.unsubscribeEnabled,
      createdAt: c.createdAt,
      sentAt: c.sentAt,
      scheduledAt: db.campaignScheduledAt(c.id),
      recipients: { listIds: c.listId ? [c.listId] : [] },
      sender: { name: c.senderName, email: c.senderEmail },
      statistics: {
        globalStats: stats.globalStats,
        campaignStats: []
      }
    }
  }))

  return { campaigns: formatted, count: formatted.length }
}

export async function getCampaign(id: number) {
  const c = db.query(`
    SELECT 
      c.id, c.name, c.subject, c.preview_text as previewText, 
      c.html_content as htmlContent, c.status, 
      c.created_at as createdAt, c.sent_at as sentAt,
      c.list_id as listId, l.name as listName,
      c.sender_id as senderId, s.name as senderName, s.email as senderEmail
    FROM campaigns c
    LEFT JOIN lists l ON c.list_id = l.id
    LEFT JOIN senders s ON c.sender_id = s.id
    WHERE c.id = ?
  `).get(id) as any

  if (!c) {
    throw new Error('Campaign not found')
  }

  const stats = await getCampaignStats(id)

  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    previewText: c.previewText,
    htmlContent: c.htmlContent,
    status: c.status,
    unsubscribeEnabled: c.unsubscribeEnabled,
    createdAt: c.createdAt,
    sentAt: c.sentAt,
    sentDate: c.sentAt, // Alias for backward compatibility
    scheduledAt: db.campaignScheduledAt(c.id),
    recipients: { 
      listIds: c.listId ? [c.listId] : [],
      lists: c.listId ? [c.listId] : [], // Alias for backward compatibility
      segments: [], // Alias for backward compatibility
    },
    sender: { id: c.senderId, name: c.senderName, email: c.senderEmail },
    replyTo: c.senderEmail, // Alias for backward compatibility
    statistics: {
      globalStats: stats.globalStats,
      campaignStats: []
    }
  }
}

export async function createCampaign(payload: {
  name: string
  subject?: string
  previewText?: string
  sender?: { name?: string; email?: string; id?: number }
  htmlContent?: string
  recipients?: { listIds?: number[] }
  unsubscribeEnabled?: boolean
}) {
  // Find or insert sender
  let senderId = payload.sender?.id || null
  if (!senderId && payload.sender?.email && payload.sender?.name) {
    const existing = db.query('SELECT id FROM senders WHERE email = ?').get(payload.sender.email) as any
    if (existing) {
      senderId = existing.id
    } else {
      db.run('INSERT INTO senders (name, email) VALUES (?, ?)', [payload.sender.name, payload.sender.email])
      senderId = (db.query('SELECT last_insert_rowid() as id').get() as { id: number }).id
    }
  }

  const listId = payload.recipients?.listIds?.[0] || null

  db.run(
    `INSERT INTO campaigns (name, subject, preview_text, html_content, list_id, sender_id, status, unsubscribe_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [
      payload.name,
      payload.subject || '',
      payload.previewText || null,
      payload.htmlContent || '',
      listId,
      senderId || null,
      payload.unsubscribeEnabled !== false,
      new Date().toISOString()
    ]
  )

  const id = (db.query('SELECT last_insert_rowid() as id').get() as { id: number }).id
  return { id }
}

export async function duplicateCampaign(id: number) {
  const campaign = await getCampaign(id)
  return createCampaign({
    name: `Copy of ${campaign.name}`,
    subject: campaign.subject,
    previewText: campaign.previewText || undefined,
    sender: {
      name: campaign.sender?.name || '',
      email: campaign.sender?.email || '',
      id: campaign.sender?.id,
    },
    htmlContent: campaign.htmlContent || '',
    recipients: campaign.recipients,
  })
}

export async function updateCampaign(id: number, payload: {
  name?: string
  subject?: string
  previewText?: string
  sender?: { name?: string; email?: string; id?: number }
  htmlContent?: string
  recipients?: { listIds: number[] }
  scheduledAt?: string
  unsubscribeEnabled?: boolean
}) {
  const existing = await getCampaign(id)
  if (existing.status === 'sent') {
    throw new Error('Cannot edit a campaign that has already been sent')
  }
  if (existing.status === 'sending') {
    throw new Error('This campaign is being sent right now, so it can\'t be changed.')
  }
  let scheduledAt: string | null = null
  if (payload.scheduledAt) {
    const at = new Date(payload.scheduledAt)
    if (Number.isNaN(at.getTime())) throw new Error('That schedule time isn\'t a valid date.')
    if (at.getTime() <= Date.now()) throw new Error('Schedule time must be in the future.')
    scheduledAt = at.toISOString()
  }

  let senderId = existing.sender?.id
  if (payload.sender) {
    if (payload.sender.id) {
      senderId = payload.sender.id
    } else if (payload.sender.email) {
      const existingSender = db.query('SELECT id FROM senders WHERE email = ?').get(payload.sender.email) as any
      if (existingSender) {
        senderId = existingSender.id
      } else {
        db.run('INSERT INTO senders (name, email) VALUES (?, ?)', [payload.sender.name || '', payload.sender.email])
        senderId = (db.query('SELECT last_insert_rowid() as id').get() as { id: number }).id
      }
    }
  }

  const listId = payload.recipients?.listIds?.[0] ?? existing.recipients?.listIds?.[0] ?? null
  const name = payload.name ?? existing.name
  const subject = payload.subject ?? existing.subject
  const previewText = payload.previewText ?? existing.previewText
  const htmlContent = payload.htmlContent ?? existing.htmlContent
  const status = existing.status
  const unsubscribeEnabled = payload.unsubscribeEnabled ?? existing.unsubscribeEnabled

  db.run(
    `UPDATE campaigns 
     SET name = ?, subject = ?, preview_text = ?, html_content = ?, list_id = ?, sender_id = ?, status = ?, unsubscribe_enabled = ?
     WHERE id = ?`,
    [name, subject, previewText, htmlContent, listId, senderId, status, unsubscribeEnabled, id]
  )
  // Sent by the email scheduler once due (emailScheduler.ts).
  if (scheduledAt) db.setCampaignSchedule(id, scheduledAt)

  return { id }
}

/** Takes a scheduled campaign off the schedule, back to a draft. */
export async function unscheduleCampaign(id: number) {
  const existing = await getCampaign(id)
  if (existing.status !== 'scheduled') throw new Error('This campaign isn\'t scheduled.')
  db.setCampaignSchedule(id, null)
  return { id }
}

export async function deleteCampaign(id: number) {
  db.run('DELETE FROM campaigns WHERE id = ?', [id])
  return { success: true }
}

/**
 * Sends a campaign to its list. `resume` finishes one the server stopped in
 * the middle of sending. Anyone it already went to is skipped, so a campaign
 * never reaches the same person twice.
 */
export async function sendCampaign(id: number, opts: { resume?: boolean } = {}) {
  const campaign = await getCampaign(id)
  if (campaign.status === 'sent') throw new Error('This campaign has already been sent.')
  if (campaign.status === 'sending' && !opts.resume) throw new Error('This campaign is already being sent.')
  const listId = campaign.recipients?.listIds?.[0]
  if (!listId) {
    throw new Error('No contact list associated with this campaign')
  }

  // Get active subscribed contacts
  const subscribed = db.query(`
    SELECT c.email, c.first_name, c.last_name
    FROM contacts c
    JOIN list_contacts lc ON c.email = lc.contact_email
    WHERE lc.list_id = ? AND c.status = 'subscribed'
  `).all(listId) as any[]

  // People who opted out of being contacted through MagpieCRM aren't sent to,
  // unless they've signed themselves up since.
  const optedOut = optedOutAt(db, subscribed)
  const contacts = subscribed.filter((c) => signedUpSince(optedOut.get(c.email), db.getContact(c.email)?.signed_up_at))
  const skippedOptOuts = subscribed.length - contacts.length
  if (subscribed.length > 0 && contacts.length === 0) {
    throw new Error(
      `Campaign not sent: all ${subscribed.length} subscribed contact${subscribed.length === 1 ? ' has' : 's have'} opted out of being contacted.`,
    )
  }

  if (subscribed.length === 0) {
    // Previously this marked the campaign 'sent' and returned success, so a
    // campaign that reached nobody was indistinguishable from one that worked.
    // Refuse instead, and leave the campaign in its current status so it can be
    // resent once the list is fixed. Nothing about the contacts is modified.
    const memberEmails = new Set(
      db.data.list_contacts.filter((lc) => lc.list_id === listId).map((lc) => lc.contact_email),
    )
    const members = db.data.contacts.filter((c) => memberEmails.has(c.email))

    if (members.length === 0) {
      throw new Error(
        `Campaign not sent: the selected list is empty. Add contacts to it and try again.`,
      )
    }

    const byStatus = members.reduce<Record<string, number>>((acc, c) => {
      const key = c.status || 'unknown'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const breakdown = Object.entries(byStatus)
      .map(([status, count]) => `${count} ${status}`)
      .join(', ')

    throw new Error(
      `Campaign not sent: none of the ${members.length} contact${members.length === 1 ? '' : 's'} ` +
        `in this list are subscribed (${breakdown}). Only subscribed contacts receive campaigns.`,
    )
  }

  // Anyone it already went to (a resumed send, or a second press of Send) is skipped.
  const alreadySent = db.campaignRecipientEmails(id)
  const toSend = contacts.filter((c) => !alreadySent.has(c.email))

  // A plan's email allowance: the whole campaign must fit, rather than stopping halfway.
  requireAllowance('emailsSent', toSend.length, 'Sending this campaign')

  const senderEmail = campaign.sender?.email
  const senderName = campaign.sender?.name
  const from = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail

  // Track recipients in the log
  const logRecipientStmt = db.prepare(`
    INSERT OR REPLACE INTO campaign_recipients (campaign_id, contact_email, status)
    VALUES (?, ?, 'sent')
  `)

  const appUrl = await getAppUrl()
  // When the host runs sending, every campaign carries an unsubscribe link.
  const unsubscribeEnabled = campaign.unsubscribeEnabled !== false || env.sendingManaged()

  // Survey blocks link to a survey; sending links to a draft or deleted one
  // would give every recipient a "not found" page.
  for (const surveyId of referencedSurveyIds(campaign.htmlContent)) {
    const survey = db.getSurvey(surveyId)
    if (!survey) throw new Error('Campaign not sent: it links to a survey that no longer exists. Update the survey block and try again.')
    if (survey.status !== 'published') {
      throw new Error(`Campaign not sent: the survey "${survey.name}" isn't published. Publish it, then send again.`)
    }
  }

  // Everything above passed: claim it. From here it's 'sending', which a
  // scheduled send and a manual one can't both do (db.claimCampaignForSending).
  if (!db.claimCampaignForSending(id, opts)) throw new Error('This campaign is already being sent.')

  try {
    for (const contact of toSend) {
      const email = contact.email
      const firstName = contact.first_name || ''
      const lastName = contact.last_name || ''
      const company = contact.company || ''

      const personalize = (text: string, isHtml: boolean) => {
        const fn = isHtml ? escapeHtml(firstName) : firstName
        const ln = isHtml ? escapeHtml(lastName) : lastName
        const comp = isHtml ? escapeHtml(company) : company
        const em = isHtml ? escapeHtml(email) : email

        return text
          .replace(/\{\{\s*contact\.first_name\s*\}\}/gi, fn)
          .replace(/\{\{\s*contact\.last_name\s*\}\}/gi, ln)
          .replace(/\{\{\s*contact\.FIRSTNAME\s*\}\}/gi, fn)
          .replace(/\{\{\s*contact\.LASTNAME\s*\}\}/gi, ln)
          .replace(/\{\{\s*contact\.COMPANY\s*\}\}/gi, comp)
          .replace(/\{\{\s*contact\.EMAIL\s*\}\}/gi, em)
          .replace(CUSTOM_FIELD_TAG, (_m: string, key: string) => {
            const value = formatCustomValue(contact.custom?.[key])
            return isHtml ? escapeHtml(value) : value
          })
      }

      // Personalize variables in subject (plain text - no HTML escape needed)
      let personalizedSubject = personalize(campaign.subject, false)

      // Personalize variables in HTML (escaped to prevent Stored XSS)
      let personalizedHtml = personalize(campaign.htmlContent, true)

      if (campaign.previewText) {
        const personalizedPreview = personalize(campaign.previewText, false)
        personalizedHtml = injectPreviewText(personalizedHtml, personalizedPreview)
      }

      // Add tracking pixel using encrypted token
      const openToken = encryptToken({ email, campaignId: id })
      const pixelUrl = `${appUrl}/api/track/open?t=${encodeURIComponent(openToken)}`
      const trackingPixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none !important;" />`
    
      // Inject tracking pixel inside <body> if present, otherwise append it
      const bodyCloseRegex = /<\/body>/i
      if (bodyCloseRegex.test(personalizedHtml)) {
        personalizedHtml = personalizedHtml.replace(bodyCloseRegex, (match: string) => `${trackingPixel}${match}`)
      } else {
        personalizedHtml += trackingPixel
      }

      // Append unsubscribe link using encrypted token
      const unsubToken = encryptToken({ email, campaignId: id })
      const unsubscribeUrl = `${appUrl}/api/unsubscribe?t=${encodeURIComponent(unsubToken)}`
      if (unsubscribeEnabled) {
        personalizedHtml = personalizedHtml.replace(/\{\{\s*unsubscribe\s*\}\}/gi, unsubscribeUrl)

        // Unless the design already links to it, add the link at the very bottom.
        if (!personalizedHtml.includes(unsubscribeUrl)) {
          const footer = `
            <div style="text-align: center; margin-top: 30px; font-size: 12px; color: #666;">
              Sent by ${escapeHtml(senderName || senderEmail || '')}. Don't want these emails?
              <a href="${unsubscribeUrl}" style="color: #666; text-decoration: underline;">Unsubscribe</a>
            </div>
          `
          personalizedHtml = /<\/body>/i.test(personalizedHtml)
            ? personalizedHtml.replace(/<\/body>/i, (m: string) => `${footer}${m}`)
            : personalizedHtml + footer
        }
      } else {
        personalizedHtml = personalizedHtml.replace(/\{\{\s*unsubscribe\s*\}\}/gi, '#')
      }

      // Per-recipient survey links, so answers are tied to this contact.
      personalizedHtml = expandSurveyPlaceholders(personalizedHtml, { appUrl, email, campaignId: id })

      // Absolutize before tokenizing, so the URL baked into the click token (and
      // therefore the eventual 302 Location) is a real absolute URL.
      personalizedHtml = absolutizeHrefs(personalizedHtml)

      // Rewrite all href links to track clicks with encrypted token
      const hrefRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"/gi
      personalizedHtml = personalizedHtml.replace(hrefRegex, (match: string, p1: string) => {
        // Survey links stay direct (shorter URLs, no extra redirect); the survey
        // page records the click itself via db.recordClick.
        if (p1.startsWith('#') || p1.startsWith('mailto:') || p1.includes('api/unsubscribe') || p1.startsWith(`${appUrl}/s/`)) {
          return match
        }
        const clickToken = encryptToken({ email, campaignId: id, url: p1 })
        const trackUrl = `${appUrl}/api/track/click?t=${encodeURIComponent(clickToken)}`
        // Target the href attribute itself — a bare `replace(p1, ...)` would hit
        // the first occurrence of the URL anywhere in the tag (a preceding
        // style/class value), corrupting the anchor instead of retargeting it.
        return match.replace(`href="${p1}"`, `href="${trackUrl}"`)
      })


      try {
        await sendMail({
          from,
          to: email,
          subject: personalizedSubject,
          html: personalizedHtml,
          campaignId: id,
          // One-click unsubscribe in the mail client (List-Unsubscribe), which Gmail and Yahoo require of bulk senders.
          ...(unsubscribeEnabled ? { unsubscribeUrl } : {}),
        })
        logRecipientStmt.run(id, email)
      } catch (err) {
        // Out of allowance isn't the recipient's fault: stop, without marking anyone bounced.
        if (err instanceof AllowanceError) throw err
        console.error(`Failed to send campaign email to ${email}:`, err)
        // Save recipient as bounced
        db.run(
          `INSERT OR REPLACE INTO campaign_recipients (campaign_id, contact_email, status)
           VALUES (?, ?, 'bounced_soft')`,
          [id, email]
        )
      }
    }
  } catch (err) {
    // Stopped partway: back to a draft. Sending again skips everyone it reached.
    db.releaseCampaign(id)
    throw err
  }

  db.run("UPDATE campaigns SET status = 'sent', sent_at = ? WHERE id = ?", [new Date().toISOString(), id])

  notify(
    'campaign_sent',
    `"${campaign.name}" finished sending to ${toSend.length} recipient${toSend.length === 1 ? '' : 's'}` +
      (skippedOptOuts ? ` (${skippedOptOuts} skipped: they opted out of being contacted)` : ''),
    { url: `/marketing/campaigns/${id}` },
  )

  return { success: true, sentCount: toSend.length, skippedOptOuts }
}

export async function sendTestEmail(payload: {
  sender: { name: string; email: string }
  to: string[]
  subject: string;
  htmlContent: string;
  previewText?: string;
}) {
  const from = payload.sender.name ? `"${payload.sender.name}" <${payload.sender.email}>` : payload.sender.email

  for (const recipient of payload.to) {
    // Lookup recipient in contacts table to use real data for the test email if available
    const normalizedEmail = recipient.toLowerCase().trim()
    const contact = db.data.contacts.find(c => c.email === normalizedEmail) || ({} as any)
    
    const fn = contact.first_name || 'TestFirstName'
    const ln = contact.last_name || 'TestLastName'
    const comp = contact.company || 'TestCompany'

    const personalize = (text: string, isHtml: boolean) => {
      if (!text) return text
      const eFn = isHtml ? escapeHtml(fn) : fn
      const eLn = isHtml ? escapeHtml(ln) : ln
      const eComp = isHtml ? escapeHtml(comp) : comp
      
      return text
        .replace(/\{\{\s*contact\.first_name\s*\}\}/gi, eFn)
        .replace(/\{\{\s*contact\.last_name\s*\}\}/gi, eLn)
        .replace(/\{\{\s*contact\.FIRSTNAME\s*\}\}/gi, eFn)
        .replace(/\{\{\s*contact\.LASTNAME\s*\}\}/gi, eLn)
        .replace(/\{\{\s*contact\.COMPANY\s*\}\}/gi, eComp)
        .replace(/\{\{\s*contact\.EMAIL\s*\}\}/gi, recipient)
        .replace(CUSTOM_FIELD_TAG, (_m: string, key: string) => {
          const value = formatCustomValue(contact.custom?.[key]) || `Test${key}`
          return isHtml ? escapeHtml(value) : value
        })
    }

    const subject = personalize(payload.subject, false)
    let htmlWithVars = personalize(payload.htmlContent, true)

    // A test send has no campaign to unsubscribe from, but the token must still
    // go — left in place it ships as a literal `href="{{ unsubscribe }}"`, which
    // is not a valid URL and de-anchors the link in the client.
    htmlWithVars = absolutizeHrefs(htmlWithVars.replace(/\{\{\s*unsubscribe\s*\}\}/gi, '#'))
    // Test survey links work end to end (even for drafts) but are flagged, so
    // they never touch contacts or results.
    htmlWithVars = expandSurveyPlaceholders(htmlWithVars, { appUrl: await getAppUrl(), email: normalizedEmail, campaignId: null, test: true })

    const finalHtml = payload.previewText
      ? injectPreviewText(htmlWithVars, personalize(payload.previewText, false))
      : htmlWithVars

    await sendMail({
      from,
      to: recipient,
      subject: `[TEST] ${subject}`,
      html: finalHtml,
    })
  }

  return { success: true }
}

// --- Analytics ---

/** What happened to one recipient, in order of how far they got. */
export type RecipientOutcome = 'complained' | 'unsubscribed' | 'bounced' | 'clicked' | 'opened' | 'sent'

function recipientOutcome(r: RecipientRecord): RecipientOutcome {
  if (r.complained_at) return 'complained'
  if (r.status === 'unsubscribed') return 'unsubscribed'
  if (r.status === 'bounced_hard' || r.status === 'bounced_soft') return 'bounced'
  if (r.clicked_at || r.status === 'clicked') return 'clicked'
  if (r.opened_at || r.status === 'opened') return 'opened'
  return 'sent'
}

const wasOpened = (r: RecipientRecord) => Boolean(r.opened_at || r.clicked_at || r.status === 'opened' || r.status === 'clicked')
const wasClicked = (r: RecipientRecord) => Boolean(r.clicked_at || r.status === 'clicked')
// Rows from before counts were kept count their first open or click once.
const openCount = (r: RecipientRecord) => r.opens ?? (wasOpened(r) ? 1 : 0)
const clickCount = (r: RecipientRecord) => r.clicks ?? (wasClicked(r) ? 1 : 0)

export async function getCampaignStats(id: number) {
  const rows = db.data.campaign_recipients.filter((r) => r.campaign_id == id)
  const count = (test: (r: RecipientRecord) => boolean) => rows.filter(test).length

  const sent = rows.length
  const softBounces = count((r) => r.status === 'bounced_soft')
  const hardBounces = count((r) => r.status === 'bounced_hard')
  const delivered = sent - softBounces - hardBounces
  const opened = count(wasOpened)
  const clicked = count(wasClicked)
  const complaints = count((r) => Boolean(r.complained_at))
  const unsubscribed = count((r) => r.status === 'unsubscribed' && !r.complained_at)
  const rate = (n: number) => (delivered > 0 ? parseFloat(((n / delivered) * 100).toFixed(2)) : 0)

  return {
    globalStats: {
      sent,
      delivered,
      uniqueOpens: opened,
      uniqueClicks: clicked,
      totalOpens: rows.reduce((n, r) => n + openCount(r), 0),
      totalClicks: rows.reduce((n, r) => n + clickCount(r), 0),
      softBounces,
      hardBounces,
      unsubscribed,
      complaints,
      openRate: rate(opened),
      clickRate: rate(clicked),
      // Older names the campaign pages and tools still read.
      uniqueViews: opened,
      viewed: opened,
      clickers: clicked,
      unsubscriptions: unsubscribed,
    },
  }
}

/**
 * Who a sent campaign reached and what each of them did, plus clicks per
 * link. Opens are counted when the email's images load, so they are a lower
 * bound where images are blocked and run high where a mail app loads them
 * automatically; clicks are the firmer signal.
 */
export async function getCampaignActivity(id: number) {
  const rows = db.data.campaign_recipients.filter((r) => r.campaign_id == id)
  const contacts = new Map(db.data.contacts.map((c) => [c.email, c]))

  const recipients = rows.map((r) => {
    const contact = contacts.get(r.contact_email)
    const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ')
    return {
      email: r.contact_email,
      name: name || null,
      company: contact?.company || null,
      outcome: recipientOutcome(r),
      bounce: r.status === 'bounced_hard' ? ('hard' as const) : r.status === 'bounced_soft' ? ('soft' as const) : null,
      sentAt: r.sent_at ?? null,
      openedAt: r.opened_at ?? null,
      lastOpenedAt: r.last_opened_at ?? r.opened_at ?? null,
      opens: openCount(r),
      clickedAt: r.clicked_at ?? null,
      clicks: clickCount(r),
      links: Object.entries(r.links ?? {})
        .map(([url, clicks]) => ({ url, clicks }))
        .sort((a, b) => b.clicks - a.clicks),
      bouncedAt: r.bounced_at ?? null,
      unsubscribedAt: r.unsubscribed_at ?? r.complained_at ?? null,
    }
  })

  const byLink = new Map<string, { url: string; clicks: number; people: number }>()
  for (const r of rows) {
    for (const [url, clicks] of Object.entries(r.links ?? {})) {
      const link = byLink.get(url) ?? { url, clicks: 0, people: 0 }
      link.clicks += clicks
      link.people += 1
      byLink.set(url, link)
    }
  }
  const links = [...byLink.values()].sort((a, b) => b.people - a.people || b.clicks - a.clicks)

  return { recipients, links }
}

// --- Senders ---

export async function getSenders() {
  const senders = db.query('SELECT id, name, email FROM senders').all() as any[]
  // Add active: true property for backward compatibility
  const formatted = senders.map(s => ({ ...s, active: true }))
  return { senders: formatted }
}

export async function createSender(name: string, email: string) {
  requireSendingDomain(email)
  const existing = db.query('SELECT id FROM senders WHERE LOWER(email) = ?').get(email.toLowerCase()) as any
  if (existing) {
    throw new Error('A sender with this email already exists')
  }
  db.run('INSERT INTO senders (name, email) VALUES (?, ?)', [name, email])
  const newSender = db.data.senders[db.data.senders.length - 1]
  return { success: true, sender: newSender }
}

export async function updateSender(id: number, name: string, email: string) {
  requireSendingDomain(email)
  const existing = db.data.senders.find(s => s.id === id)
  if (!existing) {
    throw new Error('Sender not found')
  }
  // Check email uniqueness (exclude self)
  const conflict = db.data.senders.find(s => s.email.toLowerCase() === email.toLowerCase() && s.id !== id)
  if (conflict) {
    throw new Error('Another sender with this email already exists')
  }
  db.run('UPDATE senders SET name = ?, email = ? WHERE id = ?', [name, email, id])
  return { success: true }
}

export async function deleteSender(id: number) {
  // Don't delete if it's the only sender
  if (db.data.senders.length <= 1) {
    throw new Error('Cannot delete the last remaining sender')
  }
  db.run('DELETE FROM senders WHERE id = ?', [id])
  return { success: true }
}
