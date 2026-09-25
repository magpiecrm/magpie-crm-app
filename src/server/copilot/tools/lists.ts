import { z } from 'zod'
import { defineTool } from '../types'
import { listRef, resolveListId } from './shared'

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
      }))
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
      'Delete a contact list. The contacts themselves are kept — only the list and its memberships go.',
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
