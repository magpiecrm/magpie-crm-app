import { z } from 'zod'
import { defineTool } from '../types'
import { listRef, resolveListId } from './shared'

const contactInput = z.object({
  email: z.string().email(),
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe('Contact fields, e.g. { "FIRSTNAME": "Ada", "COMPANY": "Analytical Engines" }.'),
})

export const contactTools = [
  defineTool({
    name: 'getContacts',
    description:
      'Read contacts across all lists, with their attributes and subscription status. Use this to ground personalisation in real data instead of inventing names.',
    input: {
      limit: z.number().int().positive().max(500).optional()
        .describe('Defaults to 50.'),
      offset: z.number().int().min(0).optional(),
      search: z.string().optional()
        .describe('Case-insensitive match against email, name, or company.'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ limit, offset, search }) => {
      const { getContacts } = await import('../../emailService')
      const { contacts, count } = await getContacts()

      const filtered = search
        ? contacts.filter((c: any) => {
            const haystack = [
              c.email,
              c.attributes?.FIRSTNAME,
              c.attributes?.LASTNAME,
              c.attributes?.COMPANY,
              c.attributes?.JOB_TITLE,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
            return haystack.includes(search.toLowerCase())
          })
        : contacts

      const start = offset ?? 0
      return {
        totalContacts: count,
        matched: filtered.length,
        contacts: filtered.slice(start, start + (limit ?? 50)),
      }
    },
  }),

  defineTool({
    name: 'addContacts',
    description:
      'Add contacts to a list, creating any that do not exist yet. Existing contacts keep their subscription status. People who opted out of being contacted are skipped, not added.',
    input: {
      list: listRef,
      contacts: z.array(contactInput).min(1),
    },
    target: 'server',
    destructive: true,
    handler: async ({ list, contacts }) => {
      const { addContactsToList } = await import('../../emailService')
      const listId = await resolveListId(list)
      const { added, skipped } = await addContactsToList(listId, contacts as any)
      return { listId, added, skippedOptedOut: skipped }
    },
  }),

  defineTool({
    name: 'getSenders',
    description:
      'List verified sender identities. A campaign needs one of these — never invent a from-address.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { getSenders } = await import('../../emailService')
      const { senders } = await getSenders()
      return senders
    },
  }),

  defineTool({
    name: 'getForms',
    description:
      'List the embeddable signup forms, the list each writes into, and how many submissions each has received.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { db } = await import('../../db')
      return db.getForms().map(f => ({
        id: f.id,
        name: f.name,
        fields: f.fields,
        listId: f.list_id,
        welcomeEmailEnabled: f.welcome_email_enabled,
        submissions: db.getFormSubmissionCount(f.id),
        createdAt: f.created_at,
      }))
    },
  }),
]
