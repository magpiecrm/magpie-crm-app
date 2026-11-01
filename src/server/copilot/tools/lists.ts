import { z } from 'zod'
import { defineTool } from '../types'
import { listRef, resolveListId } from './shared'
import { SENIORITY_LEVELS, HEADCOUNT_BUCKETS } from '../../prospecting/types'
import type { ContactFilter, FilterOp } from '../../../features/contacts/contactFilters'

const filtersInput = z
  .array(
    z.object({
      field: z.string().describe('email, first_name, last_name, job_title, company, seniority, company_size, industry, country, linkedin_url, status, email_status, source, created_at, opened, clicked, replied, or custom:<key> for a custom field.'),
      op: z
        .string()
        .describe(
          'Text fields: contains_any or contains_none with `values`, which match whole words, so "CTO" isn\'t found in "Director". Choice fields (seniority, company_size, industry, country, status, email_status, source): is_any or is_none with `values`. created_at: on_or_after or on_or_before with `value` as YYYY-MM-DD. opened, clicked, replied: in_last_days or not_in_last_days with `value` as a number of days. Any field: not_empty or empty, with neither.',
        ),
      value: z.string().optional(),
      values: z.array(z.string()).optional().describe(`Seniority is one of ${SENIORITY_LEVELS.join(', ')}; company_size one of ${HEADCOUNT_BUCKETS.join(', ')}.`),
    }),
  )
  .min(1)
  .describe('Someone must pass every filter. A filter that can\'t be applied is refused, never skipped. "replied" sees sequence emails only.')

const asFilters = (filters: Array<{ field: string; op: string; value?: string; values?: string[] }>): ContactFilter[] =>
  filters.map((f, i) => ({ id: `${f.field}:${i}`, field: f.field, op: f.op as FilterOp, value: f.value ?? '', ...(f.values ? { values: f.values } : {}) }))

export const listTools = [
  defineTool({
    name: 'getLists',
    description:
      'List every contact list with its ID, name, and contact count. Call this before any tool that takes a list, so you use a real ID rather than guessing.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { getLists } = await import('../../emailService')
      const { lists } = await getLists()
      return lists.map((l: any) => ({
        id: l.id,
        name: l.name,
        totalContacts: l.totalContacts ?? 0,
        createdAt: l.createdAt,
        builtFromFilters: Boolean(l.builtFrom),
      }))
    },
  }),

  defineTool({
    name: 'previewListFilters',
    description:
      "See who a list would hold before making it: pass `filters` for a new list, or `list` for who adding new matches to a list built from filters would add. Returns counts only: how many match, how many can be emailed, and why the rest can't. It finds nobody new: for that, use prospect search.",
    input: { filters: filtersInput.optional(), list: listRef.optional() },
    target: 'server',
    readOnly: true,
    handler: async ({ filters, list }) => {
      const { previewList, previewNewMatches } = await import('../../listBuilder')
      if (filters) return previewList(asFilters(filters))
      if (list === undefined) throw new Error('Pass filters, or a list built from filters.')
      return previewNewMatches(await resolveListId(list))
    },
  }),

  defineTool({
    name: 'createListFromFilters',
    description:
      'Make a list of existing contacts picked by filters, for example everyone in the UK with CEO or Founder in their title. It fills the list once and keeps the filters; it never changes by itself. Preview it first and tell the user the count.',
    input: {
      name: z.string().min(1).describe('Display name for the list.'),
      filters: filtersInput,
    },
    target: 'server',
    destructive: true,
    handler: async ({ name, filters }) => {
      const { buildList } = await import('../../listBuilder')
      return buildList({ name, filters: asFilters(filters) })
    },
  }),

  defineTool({
    name: 'addNewListMatches',
    description:
      "Add contacts who now match a list built from filters. Nobody is removed, and anyone taken off by hand stays off. Refused if one of the list's filters can no longer be applied.",
    input: { list: listRef },
    target: 'server',
    destructive: true,
    handler: async ({ list }) => {
      const { addNewMatches } = await import('../../listBuilder')
      return addNewMatches(await resolveListId(list))
    },
  }),

  defineTool({
    name: 'createList',
    description: 'Create an empty contact list. Returns the new list ID.',
    input: {
      name: z.string().min(1).describe('Display name for the list.'),
    },
    target: 'server',
    handler: async ({ name }) => {
      const { createList } = await import('../../emailService')
      return createList(name.trim())
    },
  }),

  defineTool({
    name: 'getListContacts',
    description:
      'Read the contacts belonging to one list. Use this to check who would receive a campaign before creating or sending it.',
    input: {
      list: listRef,
      limit: z.number().int().positive().max(500).optional()
        .describe('Cap the number returned. Defaults to 100.'),
    },
    target: 'server',
    readOnly: true,
    handler: async ({ list, limit }) => {
      const { getListContacts } = await import('../../emailService')
      const listId = await resolveListId(list)
      const { contacts, count } = await getListContacts(listId)
      return { listId, count, contacts: contacts.slice(0, limit ?? 100) }
    },
  }),

  defineTool({
    name: 'deleteList',
    description:
      "Delete a contact list. The contacts themselves are kept — only the list and its memberships go. Refused, saying why, for the default list, the only list, and a list a form, survey or unfinished campaign still uses.",
    input: { list: listRef },
    target: 'server',
    destructive: true,
    handler: async ({ list }) => {
      const { deleteList } = await import('../../emailService')
      const listId = await resolveListId(list)
      await deleteList(listId)
      return { deleted: listId }
    },
  }),
]
