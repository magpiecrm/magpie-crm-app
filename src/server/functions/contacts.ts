import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { CONTACT_FIELD_TYPES, FIELD_LIMITS, type ContactCustomValue } from '../../features/contacts/contactFields'

export const contactsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { limit?: number; offset?: number } | undefined) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { getContacts } = await import('../emailService')
    await requireAuth()
    return getContacts(data?.limit, data?.offset)
  })

export const deleteContactsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { emails: string[] }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { deleteContacts } = await import('../emailService')
    await requireAuth()
    return deleteContacts(data.emails)
  })

export const listContactsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { listId: number }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { getListContacts } = await import('../emailService')
    await requireAuth()
    return getListContacts(data.listId)
  })

export const createContactFn = createServerFn({ method: 'POST' })
  .inputValidator((d: {
    email: string;
    attributes?: Record<string, any>;
    custom?: Record<string, unknown>;
    listIds?: number[]
  }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { createContact } = await import('../emailService')
    await requireAuth()
    return createContact(data)
  })

const contactsToAdd = z.object({
  listId: z.number(),
  contacts: z.array(z.object({ email: z.string().max(320), attributes: z.record(z.string(), z.string()).optional(), custom: z.record(z.string(), z.unknown()).optional() })),
})

export const addContactsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof contactsToAdd>) => contactsToAdd.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { addContactsToList } = await import('../emailService')
    await requireAuth()
    return addContactsToList(data.listId, data.contacts)
  })

export const getContactDetailsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    const jsonDb = db as any
    const dbData = jsonDb.data

    const contact = dbData.contacts.find((c: any) => c.email.toLowerCase() === data.email.toLowerCase())
    if (!contact) {
      return { success: false, error: 'Contact not found' }
    }

    // Find lists the contact belongs to
    const listEmails = dbData.list_contacts
      .filter((lc: any) => lc.contact_email.toLowerCase() === data.email.toLowerCase())
      .map((lc: any) => lc.list_id)

    const lists = dbData.lists.filter((l: any) => listEmails.includes(l.id))

    // Find campaigns sent to this contact
    // Not sequence emails (their steps' hidden rows): those are under `sequences`.
    const sequenceRows = new Set(dbData.campaigns.filter((c: any) => c.sequence_id).map((c: any) => c.id))
    const campaignRecipients = dbData.campaign_recipients.filter(
      (cr: any) => cr.contact_email.toLowerCase() === data.email.toLowerCase() && !sequenceRows.has(cr.campaign_id)
    )

    const campaigns = campaignRecipients.map((cr: any) => {
      const campaign = dbData.campaigns.find((c: any) => c.id === cr.campaign_id)
      return {
        campaignId: cr.campaign_id,
        status: cr.status,
        openedAt: cr.opened_at,
        clickedAt: cr.clicked_at,
        campaignName: campaign ? campaign.name : `Campaign #${cr.campaign_id}`,
        subject: campaign ? campaign.subject : '',
        sentAt: campaign ? campaign.sent_at : null
      }
    })

    const { contactActivity, contactSurveyResponses } = await import('../contactActivity')

    return {
      success: true,
      contact: {
        email: contact.email,
        status: contact.status,
        createdAt: contact.created_at,
        attributes: {
          FIRSTNAME: contact.first_name || '',
          LASTNAME: contact.last_name || '',
          JOB_TITLE: contact.job_title || '',
          COMPANY: contact.company || '',
        },
        custom: (contact.custom ?? {}) as Record<string, ContactCustomValue>,
        linkedinUrl: (contact.linkedin_url as string | undefined) ?? '',
        country: (contact.country as string | undefined) ?? '',
      },
      fieldDefs: db.getContactFields(),
      lists,
      campaigns,
      sequences: (await import('../sequences')).sequences.forContact(contact.email),
      surveyResponses: contactSurveyResponses(contact.email),
      activity: contactActivity(contact.email),
    }
  })

/** Who an email from a contact's record comes from (the workspace's default sender, as `sendMail` uses it), for the dialog to say. */
export const getDefaultSenderFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  await requireAuth()
  const { getActiveProviderConfig } = await import('../emailSettings')
  return { sender: getActiveProviderConfig().defaultSender ?? null }
})

export const sendIndividualEmailFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string; subject: string; htmlContent: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { sendMail } = await import('../nodemailer')
    const { db } = await import('../db')
    await requireAuth()

    // Not to someone who unsubscribed, complained or whose address bounced.
    const status = db.getContact(data.email)?.status
    const stop = db.emailStop(data.email)
    if ((status && status !== 'subscribed') || stop) {
      const why = stop?.reason === 'bounced' || status === 'bounced' ? 'their address bounced' : 'they unsubscribed'
      throw new Error(`Not sent: ${why}. Re-subscribe them first if they've asked to hear from you again.`)
    }

    await sendMail({
      to: data.email,
      subject: data.subject,
      html: data.htmlContent,
    })

    return { success: true }
  })


// Restores a contact to the subscriber pool. Single-contact by design — see the
// note on `resubscribeContact` about why no other write path can do this.
export const resubscribeContactFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false as const, error: 'Unauthorized' }
    }

    const { resubscribeContact } = await import('../emailService')
    try {
      const { previousStatus, changed } = await resubscribeContact(data.email)
      return { success: true as const, previousStatus, changed }
    } catch (err: any) {
      return { success: false as const, error: err?.message || 'Failed to resubscribe contact' }
    }
  })

export const getContactFieldsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { db } = await import('../db')
  await requireAuth()
  return db.getContactFields()
})

const fieldOptions = z.array(z.string().trim().min(1).max(FIELD_LIMITS.optionLength)).max(FIELD_LIMITS.options).optional()

const contactFieldSchema = z.object({
  key: z.string().max(40),
  label: z.string().trim().min(1).max(FIELD_LIMITS.labelLength),
  type: z.enum(CONTACT_FIELD_TYPES),
  options: fieldOptions,
  /** Show it on this table straight away. */
  showIn: z.enum(['contacts', 'list']).optional(),
})

export const createContactFieldFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof contactFieldSchema>) => contactFieldSchema.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { createField } = await import('../contactFieldValues')
    await requireAuth()
    const { showIn, ...field } = data
    return createField(field, { showIn })
  })

const contactFieldEdit = z.object({ key: z.string().max(40), label: z.string().trim().min(1).max(FIELD_LIMITS.labelLength), options: fieldOptions })

export const updateContactFieldFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof contactFieldEdit>) => contactFieldEdit.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { editField } = await import('../contactFieldValues')
    await requireAuth()
    const { key, ...patch } = data
    return editField(key, patch)
  })

const contactFieldKey = z.object({ key: z.string().max(40) })

const contactValues = z.object({ email: z.string().max(320), values: z.record(z.string(), z.unknown()) })

/** Writes some of a contact's custom values; a blank clears one. Says what it couldn't take. */
export const setContactCustomFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof contactValues>) => contactValues.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    const { writeCustomValues } = await import('../contactFieldValues')
    await requireAuth()
    const { problems, notFound } = writeCustomValues([data], { blanks: 'clear' })
    if (notFound.length) throw new Error('Contact not found')
    const email = data.email.toLowerCase().trim()
    return { custom: (db.data.contacts.find((c) => c.email === email)?.custom ?? {}) as Record<string, ContactCustomValue>, problems: problems.map((p) => p.problem) }
  })

export const getContactColumnsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  const { db } = await import('../db')
  await requireAuth()
  return db.getContactColumns()
})

const contactColumnsInput = z.object({ view: z.enum(['contacts', 'list']), columns: z.array(z.string().max(60)).max(100).nullable() })

/** The columns a table shows, for everyone in the workspace; `null` goes back to its defaults. */
export const saveContactColumnsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof contactColumnsInput>) => contactColumnsInput.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    const { columnsToSave } = await import('../../features/contacts/contactColumns')
    await requireAuth()
    db.saveContactColumns(data.view, data.columns && columnsToSave(data.columns, db.getContactFields()))
    return db.getContactColumns()
  })

export const deleteContactFieldFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof contactFieldKey>) => contactFieldKey.parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    const { db } = await import('../db')
    await requireAuth()
    db.deleteContactField(data.key)
    return { success: true }
  })
