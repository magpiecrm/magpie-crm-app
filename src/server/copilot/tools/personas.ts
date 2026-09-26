import { z } from 'zod'
import { defineTool } from '../types'

const criteria = z.object({
  title: z.array(z.string()).optional(),
  industry: z.array(z.string()).optional()
    .describe('Exact values from searchIndustries.'),
  location: z.array(z.string()).optional(),
  employeeCount: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  seniority: z.array(z.string()).optional(),
  excludedTitles: z.array(z.string()).optional(),
})

export const personaTools = [
  defineTool({
    name: 'getPersonas',
    description:
      'List saved buyer personas with their targeting criteria. Use these to ground campaign copy in who the user actually sells to.',
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
      'Update the persona open in the builder. Each field you send REPLACES the current value wholesale, so when adding to a list you must include the existing entries — read them with getOpenPersona first.',
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
