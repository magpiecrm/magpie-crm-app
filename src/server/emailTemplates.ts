import { db } from './db'
import type { EmailTemplate } from '../features/templates/types'
import { STARTER_TEMPLATES } from '../features/email-builder/templates/starters'
import { compileHTML } from '../features/email-builder/utils/compiler'
import { DEFAULT_GLOBAL_STYLE } from '../features/email-builder/utils/design'
import type { EmailBlock, GlobalStyle } from '../features/email-builder/types'

/**
 * Saved email template operations, shared by the server functions and the
 * copilot tools so both apply the same rules.
 */

export function listTemplates(): EmailTemplate[] {
  return [...db.getEmailTemplates()].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function getTemplateOrThrow(id: string): EmailTemplate {
  const template = db.getEmailTemplate(id)
  if (!template) throw new Error('Template not found')
  return template
}

export function compileDesign(blocks: EmailBlock[], globalStyle: Partial<GlobalStyle>): string {
  return compileHTML(blocks, { ...DEFAULT_GLOBAL_STYLE, ...globalStyle })
}

export interface CreateTemplateInput {
  name: string
  description?: string
  /** Compiled builder HTML. Takes precedence over the other sources. */
  html?: string
  /** Copy the body of an existing campaign. */
  fromCampaignId?: number
  /** Start from one of the built-in starter layouts. */
  starterId?: string
}

export async function createTemplate(input: CreateTemplateInput): Promise<EmailTemplate> {
  let html: string
  if (input.html !== undefined) {
    html = input.html
  } else if (input.fromCampaignId !== undefined) {
    const { getCampaign } = await import('./emailService')
    const campaign = await getCampaign(input.fromCampaignId)
    html = campaign.htmlContent ?? ''
  } else if (input.starterId) {
    const starter = STARTER_TEMPLATES.find(t => t.id === input.starterId)
    if (!starter) {
      throw new Error(`Unknown starter "${input.starterId}". Available: ${STARTER_TEMPLATES.map(t => t.id).join(', ')}.`)
    }
    html = compileDesign(starter.build(), starter.globalStyle)
  } else {
    html = compileDesign([], {})
  }

  return db.addEmailTemplate({
    name: input.name.trim() || 'Untitled template',
    description: input.description?.trim() ?? '',
    html,
  })
}

export function updateTemplate(id: string, patch: { name?: string; description?: string; html?: string }): EmailTemplate {
  const template = getTemplateOrThrow(id)
  const next: Partial<EmailTemplate> = {}
  if (patch.name !== undefined) next.name = patch.name.trim() || template.name
  if (patch.description !== undefined) next.description = patch.description.trim()
  if (patch.html !== undefined) next.html = patch.html
  return db.updateEmailTemplate(id, next)!
}

export function duplicateTemplate(id: string): EmailTemplate {
  const template = getTemplateOrThrow(id)
  return db.addEmailTemplate({
    name: `${template.name} (copy)`,
    description: template.description,
    html: template.html,
  })
}

export function deleteTemplate(id: string) {
  getTemplateOrThrow(id)
  db.deleteEmailTemplate(id)
}
