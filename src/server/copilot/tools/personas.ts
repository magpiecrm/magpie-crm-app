import { z } from 'zod'
import { defineTool } from '../types'
import { personaCriteriaInput } from '../../prospecting/personaInput'

// The same filters as searchPeople's, so a saved persona's criteria can go to it as they are.
// Industries are checked in the handler: the whole list in the schema would go with every request.
const criteria = personaCriteriaInput.partial().extend({
  industries: z.array(z.string()).optional().describe('Exact values from searchIndustries.'),
  companySizes: personaCriteriaInput.shape.companySizes
    .optional()
    .describe('Sizes are searched companies first, so they need `industries` or `keyword` too.'),
  keyword: personaCriteriaInput.shape.keyword.optional().describe('One term companies are found by, e.g. "fintech".'),
})

export const personaTools = [
  defineTool({
    name: 'getPersonas',
    description:
      'List saved buyer personas: their criteria (searchPeople\'s own filters, so they can be passed to it as they are), pain points and value proposition. Use these to ground campaign copy in who the user actually sells to.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { db } = await import('../../db')
      return db.getPersonas()
    },
  }),

  defineTool({
    name: 'getOpenPersona',
    description:
      'Read the unsaved persona currently open in the persona builder. Call this before updatePersona so you can extend the existing values instead of overwriting them.',
    input: {},
    target: 'server',
    browserOnly: true,
    readOnly: true,
    handler: async (_args, ctx) => {
      const persona = ctx.getClientState().persona
      if (!persona) {
        throw new Error('The persona builder is not open. Use getPersonas to read saved personas instead.')
      }
      return persona
    },
  }),

  defineTool({
    name: 'updatePersona',
    description:
      'Update the persona open in the builder. Each field you send, and each criteria key, REPLACES the current value wholesale, so when adding to a list you must include the existing entries — read them with getOpenPersona first. Criteria keys you leave out stay as they are.',
    input: {
      name: z.string().optional(),
      description: z.string().optional(),
      painPoints: z.string().optional(),
      valueProp: z.string().optional(),
      criteria: criteria.optional(),
    },
    target: 'client',
    handler: async (args, ctx) => {
      if (!ctx.getClientState().persona) {
        throw new Error('The persona builder is not open, so there is nothing to update.')
      }
      const { INDUSTRIES } = await import('../../../features/prospects/constants/industries')
      const unknown = (args.criteria?.industries ?? []).filter((i) => !INDUSTRIES.includes(i))
      if (unknown.length) {
        throw new Error(`Not in the industry list: ${unknown.join(', ')}. Resolve each with searchIndustries and use its exact value.`)
      }
      const updates = Object.fromEntries(
        Object.entries(args).filter(([, v]) => v !== undefined),
      )
      if (Object.keys(updates).length === 0) {
        throw new Error('updatePersona needs at least one field to change.')
      }
      ctx.emitClientAction({ action: 'updatePersona', args: updates })
      return { updated: Object.keys(updates) }
    },
  }),
]
