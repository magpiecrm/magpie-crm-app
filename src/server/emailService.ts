import { db } from './db'
import { sendMail } from './nodemailer'
import { encryptToken } from './crypto'
import { notify } from './notify'
import { getAppUrl } from './appUrl'
import { normalizeHref } from '../features/email-builder/utils/html'
import { expandSurveyPlaceholders, referencedSurveyIds } from './surveyLinks'
import { formatCustomValue } from '../features/contacts/contactFields'
import { AllowanceError, requireAllowance } from './allowance'

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

export async function addContactsToList(listId: number, contacts: EmailContact[]) {
  const insertContactStmt = db.prepare(`
    INSERT OR REPLACE INTO contacts (email, first_name, last_name, job_title, company, status, created_at)
    VALUES (?, ?, ?, ?, ?, COALESCE((SELECT status FROM contacts WHERE email = ?), 'subscribed'), ?)
  `)

  const linkContactStmt = db.prepare(`
    INSERT OR IGNORE INTO list_contacts (list_id, contact_email)
    VALUES (?, ?)
  `)

  const now = new Date().toISOString()
  db.transaction(() => {
    for (const c of contacts) {
      const email = c.email.toLowerCase().trim()
      const fn = c.attributes?.FIRSTNAME || ''
      const ln = c.attributes?.LASTNAME || ''
      const jt = c.attributes?.JOB_TITLE || ''
      const comp = c.attributes?.COMPANY || ''

      insertContactStmt.run(email, fn, ln, jt, comp, email, now)
      linkContactStmt.run(listId, email)
    }
  })()
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

  // Convert SQLite fields to match Brevo API shape
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
  const status = payload.scheduledAt ? 'scheduled' : existing.status
  const unsubscribeEnabled = payload.unsubscribeEnabled ?? existing.unsubscribeEnabled

  db.run(
    `UPDATE campaigns 
     SET name = ?, subject = ?, preview_text = ?, html_content = ?, list_id = ?, sender_id = ?, status = ?, unsubscribe_enabled = ?
     WHERE id = ?`,
    [name, subject, previewText, htmlContent, listId, senderId, status, unsubscribeEnabled, id]
  )

  return { id }
}

export async function deleteCampaign(id: number) {
  db.run('DELETE FROM campaigns WHERE id = ?', [id])
  return { success: true }
}

export async function sendCampaign(id: number) {
  const campaign = await getCampaign(id)
  const listId = campaign.recipients?.listIds?.[0]
  if (!listId) {
    throw new Error('No contact list associated with this campaign')
  }

  // Get active subscribed contacts
  const contacts = db.query(`
    SELECT c.email, c.first_name, c.last_name
    FROM contacts c
    JOIN list_contacts lc ON c.email = lc.contact_email
    WHERE lc.list_id = ? AND c.status = 'subscribed'
  `).all(listId) as any[]

  if (contacts.length === 0) {
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

  // A plan's email allowance: the whole campaign must fit, rather than stopping halfway.
  requireAllowance('emailsSent', contacts.length, 'Sending this campaign')

  const senderEmail = campaign.sender?.email
  const senderName = campaign.sender?.name
  const from = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail

  // Track recipients in the log
  const logRecipientStmt = db.prepare(`
    INSERT OR REPLACE INTO campaign_recipients (campaign_id, contact_email, status)
    VALUES (?, ?, 'sent')
  `)

  const appUrl = await getAppUrl()

  // Survey blocks link to a survey; sending links to a draft or deleted one
  // would give every recipient a "not found" page.
  for (const surveyId of referencedSurveyIds(campaign.htmlContent)) {
    const survey = db.getSurvey(surveyId)
    if (!survey) throw new Error('Campaign not sent: it links to a survey that no longer exists. Update the survey block and try again.')
    if (survey.status !== 'published') {
      throw new Error(`Campaign not sent: the survey "${survey.name}" isn't published. Publish it, then send again.`)
    }
  }

  // Send to all contacts
  for (const contact of contacts) {
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
    if (campaign.unsubscribeEnabled) {
      personalizedHtml = personalizedHtml.replace(/\{\{\s*unsubscribe\s*\}\}/gi, unsubscribeUrl)

      // Add basic email wrap support to also auto-add unsubscribe at absolute bottom if not already included
      if (!personalizedHtml.includes(unsubscribeUrl) && !personalizedHtml.includes('unsubscribe')) {
        personalizedHtml += `
          <div style="text-align: center; margin-top: 30px; font-size: 12px; color: #666;">
            You received this email because you subscribed. 
            <a href="${unsubscribeUrl}" style="color: #007bff; text-decoration: underline;">Unsubscribe</a>
          </div>
        `
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
      // page records the click itself via markRecipientClicked.
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

  db.run("UPDATE campaigns SET status = 'sent', sent_at = ? WHERE id = ?", [new Date().toISOString(), id])

  notify(
    'campaign_sent',
    `"${campaign.name}" finished sending to ${contacts.length} recipient${contacts.length === 1 ? '' : 's'}`,
    { url: `/marketing/campaigns/${id}` },
  )

  return { success: true, sentCount: contacts.length }
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

export async function getCampaignStats(id: number) {
  const stats = db.query(`
    SELECT status, COUNT(*) as count 
    FROM campaign_recipients 
    WHERE campaign_id = ? 
    GROUP BY status
  `).all(id) as Array<{ status: string, count: number }>

  const summary = {
    sent: 0,
    opened: 0,
    clicked: 0,
    bounced_soft: 0,
    bounced_hard: 0,
    unsubscribed: 0,
  }

  for (const s of stats) {
    if (s.status === 'sent') {
      summary.sent += s.count
    } else if (s.status === 'opened') {
      summary.opened += s.count
      summary.sent += s.count // Opened counts as sent
    } else if (s.status === 'clicked') {
      summary.clicked += s.count
      summary.opened += s.count // Clicked also counts as opened!
      summary.sent += s.count // Clicked counts as sent
    } else if (s.status === 'bounced_soft') {
      summary.bounced_soft += s.count
    } else if (s.status === 'bounced_hard') {
      summary.bounced_hard += s.count
    } else if (s.status === 'unsubscribed') {
      summary.unsubscribed += s.count
      summary.opened += s.count // Unsubscribed also counts as opened!
      summary.sent += s.count
    }
  }

  // Calculate rate percentages for frontend compatibility
  const totalSent = summary.sent || 1
  return {
    globalStats: {
      sent: summary.sent,
      delivered: summary.sent - (summary.bounced_soft + summary.bounced_hard),
      uniqueClicks: summary.clicked,
      uniqueOpens: summary.opened,
      uniqueViews: summary.opened, // Alias for backward compatibility
      viewed: summary.opened, // Alias for backward compatibility
      clickers: summary.clicked, // Alias for backward compatibility
      softBounces: summary.bounced_soft,
      hardBounces: summary.bounced_hard,
      unsubscribed: summary.unsubscribed,
      unsubscriptions: summary.unsubscribed, // Alias for backward compatibility
      openRate: parseFloat(((summary.opened / totalSent) * 100).toFixed(2)),
      clickRate: parseFloat(((summary.clicked / totalSent) * 100).toFixed(2)),
    }
  }
}

// --- Senders ---

export async function getSenders() {
  const senders = db.query('SELECT id, name, email FROM senders').all() as any[]
  // Add active: true property for backward compatibility
  const formatted = senders.map(s => ({ ...s, active: true }))
  return { senders: formatted }
}

export async function createSender(name: string, email: string) {
  const existing = db.query('SELECT id FROM senders WHERE LOWER(email) = ?').get(email.toLowerCase()) as any
  if (existing) {
    throw new Error('A sender with this email already exists')
  }
  db.run('INSERT INTO senders (name, email) VALUES (?, ?)', [name, email])
  const newSender = db.data.senders[db.data.senders.length - 1]
  return { success: true, sender: newSender }
}

export async function updateSender(id: number, name: string, email: string) {
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
