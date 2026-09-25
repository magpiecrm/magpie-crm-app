import { z } from 'zod'
import { defineTool } from '../types'

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour like #10b981')

export const brandTools = [
  defineTool({
    name: 'getBrandKit',
    description:
      'Read the saved brand kit — colours, logo, font and tone of voice. These are already summarised in your system prompt; call this only if you need the exact values or suspect they changed this session.',
    input: {},
    target: 'server',
    readOnly: true,
    handler: async () => {
      const { db } = await import('../../db')
      return db.getBrandKit() ?? { note: 'No brand kit saved yet. Offer to set one up with setBrandKit.' }
    },
  }),

  defineTool({
    name: 'setBrandKit',
    description:
      'Save or update the brand kit. Only the fields you pass change. Ask the user before guessing at their brand — do not invent colours or a tone of voice.',
    input: {
      name: z.string().optional().describe('Brand or company name.'),
      logoUrl: z.string().url().optional(),
      primaryColor: hexColor.optional().describe('Main brand colour, used for buttons and links.'),
      accentColor: hexColor.optional(),
      backgroundColor: hexColor.optional().describe('Default email background.'),
      textColor: hexColor.optional(),
      fontFamily: z.string().optional().describe('Web-safe stack, e.g. "Helvetica, Arial, sans-serif".'),
      toneOfVoice: z.string().optional().describe('How copy should read, e.g. "warm and direct, no jargon".'),
      websiteUrl: z.string().url().optional(),
      footerAddress: z.string().optional().describe('Postal address for the legal footer.'),
    },
    target: 'server',
    handler: async (args) => {
      const patch = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined))
      if (Object.keys(patch).length === 0) {
        throw new Error('setBrandKit needs at least one field to change.')
      }
      const { db } = await import('../../db')
      return db.saveBrandKit(patch)
    },
  }),

  defineTool({
    name: 'applyBrandToDesign',
    description:
      'Apply the saved brand kit to the open design in one step — background, text, button and link colours, font, and the footer address. Use this when the user says "make it on-brand" rather than setting each value by hand.',
    input: {},
    target: 'client',
    handler: async (_args, ctx) => {
      const { db } = await import('../../db')
      const brand = db.getBrandKit()
      if (!brand) throw new Error('No brand kit saved yet. Use setBrandKit first, or ask the user for their colours.')
      if (!ctx.getClientState().builder) {
        throw new Error('The email builder is not open, so there is no design to brand.')
      }

      const updates: Record<string, unknown> = {}
      if (brand.primaryColor) {
        updates.buttonBgColor = brand.primaryColor
        updates.linkColor = brand.primaryColor
      }
      if (brand.backgroundColor) updates.bodyBgColor = brand.backgroundColor
      if (brand.fontFamily) updates.fontFamily = brand.fontFamily
      if (brand.footerAddress) updates.footerText = brand.footerAddress

      if (Object.keys(updates).length === 0) {
        throw new Error('The brand kit has no design-affecting fields set (colours, font, or footer address).')
      }
      ctx.emitClientAction({ action: 'setGlobalStyle', args: { updates } })
      return { applied: Object.keys(updates), brand: brand.name ?? null }
    },
  }),
]
