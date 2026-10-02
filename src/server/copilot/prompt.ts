import { z } from 'zod'
import { COPILOT_TOOLS } from './tools'
import { BLOCK_TYPES, GLOBAL_STYLE_KEYS } from '../../features/email-builder/types'
import { SURVEY_BLOCK_TYPES, SURVEY_THEME_KEYS } from '../../features/survey-builder/types'
import type { CopilotClientState } from './types'

/**
 * Render one Zod field as a compact type hint. Deliberately shallow: the model
 * gets the authoritative JSON Schema with each tool's definition, and this
 * reference exists to tell it *when* to use a tool, not to restate the schema.
 */
function describeField(name: string, schema: z.ZodTypeAny): string {
  const optional = schema.safeParse(undefined).success
  // Keep the outermost description, then unwrap optional/nullable/default so we
  // report the underlying type rather than the wrapper.
  const outerDef: any = (schema as any).def ?? (schema as any)._def
  const description = outerDef?.description ?? (schema as any).description

  let inner: any = schema
  let def: any = outerDef
  while (def && ['optional', 'nullable', 'default', 'catch'].includes(def.type)) {
    inner = def.innerType ?? inner
    def = (inner as any).def ?? (inner as any)._def
  }

  let kind = 'value'
  const typeName: string = def?.type ?? ''
  if (typeName === 'string') kind = 'string'
  else if (typeName === 'number') kind = 'number'
  else if (typeName === 'boolean') kind = 'boolean'
  else if (typeName === 'array') kind = 'array'
  else if (typeName === 'object') kind = 'object'
  else if (typeName === 'enum') kind = Object.values(def.entries ?? {}).map(v => JSON.stringify(v)).join(' | ')
  else if (typeName === 'union') {
    const opts = (def.options ?? []).map((o: any) => {
      const t = ((o as any).def ?? (o as any)._def)?.type
      return t === 'string' ? 'string' : t === 'number' ? 'number' : t ?? 'value'
    })
    kind = [...new Set(opts)].join(' | ') || 'value'
  }
  else if (typeName === 'record') kind = 'object'

  return `    - \`${name}\`${optional ? ' (optional)' : ''}: ${kind}${description ? ` — ${description}` : ''}`
}

/** The tool reference, generated from the registry so it can never drift. */
function renderToolReference(): string {
  const lines: string[] = ['## Tools', '']
  for (const tool of COPILOT_TOOLS) {
    const tags = [
      tool.readOnly ? 'read-only' : null,
      tool.destructive ? 'destructive — may require user approval' : null,
      tool.target === 'client' ? 'edits the open builder/persona, not the database' : null,
    ].filter(Boolean)

    lines.push(`### ${tool.name}${tags.length ? ` _(${tags.join('; ')})_` : ''}`)
    lines.push(tool.description)

    const fields = Object.entries(tool.input)
    if (fields.length === 0) {
      lines.push('  - No arguments.')
    } else {
      lines.push('  - Arguments:')
      for (const [name, schema] of fields) {
        lines.push(describeField(name, schema as z.ZodTypeAny))
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** The block-model reference, generated from `BLOCK_TYPES`. Also given to outside AI apps (mcp.ts). */
export function renderBlockReference(): string {
  const lines: string[] = [
    '## Email block model',
    '',
    'Every block is `{ id, type, content, ...fields, style? }`. Build designs from these native blocks — reach for `html` only when the user explicitly asks for raw markup.',
    '',
  ]
  for (const b of BLOCK_TYPES) {
    lines.push(`- \`${b.type}\` — ${b.description} Fields: ${b.fields.join(', ')}.`)
  }
  lines.push('')
  lines.push('Blocks may nest: a `section` holds other blocks in `children`. Block ids inside a section are addressable by every block tool, and `addBlock` takes a `parentId` to place a block inside one.')
  lines.push('')
  lines.push('### Page-level style (setGlobalStyle)')
  for (const g of GLOBAL_STYLE_KEYS) {
    lines.push(`- \`${g.key}\` — ${g.description}`)
  }
  lines.push('')
  lines.push('Shared block style keys: `color`, `bgColor`, `fontSize`, `fontWeight`, `padding` (or per-side `paddingTop`/`paddingRight`/`paddingBottom`/`paddingLeft`), `btnBgColor`, `btnTextColor`, `btnRadius`, `dividerColor`, `height`, `fontFamily`, `textAlign`, `linkColor`, `borderColor`.')
  return lines.join('\n')
}

/** The survey model reference, generated from `SURVEY_BLOCK_TYPES` / `SURVEY_THEME_KEYS`. Also given to outside AI apps. */
export function renderSurveyReference(): string {
  const lines: string[] = [
    '## Survey model',
    '',
    'A survey is `{ pages: [{ id, title?, blocks, rules?, defaultNext? }], theme }`. Blocks are content or questions; question blocks carry `question: { title, required, ... }`.',
    '',
  ]
  for (const b of SURVEY_BLOCK_TYPES) {
    lines.push(`- \`${b.type}\`${b.isQuestion ? ' (question)' : ''} — ${b.description} Fields: ${b.fields.join(', ')}.`)
  }
  lines.push('')
  lines.push(
    'Skip logic: each page has ordered `rules: [{ when, goTo }]` checked after the page (first match wins), then `defaultNext`, then the next page. Jumps only go forward. Choice conditions compare option ids, not labels.',
  )
  lines.push(
    'Saving answers to contacts: `question.mapTo = { field, overwrite }` where field is first_name | last_name | job_title | company | `custom:<key>` (see getContactFields / createContactField) and overwrite is always | if_empty.',
  )
  lines.push('')
  lines.push('### Survey theme (setSurveyTheme)')
  for (const t of SURVEY_THEME_KEYS) lines.push(`- \`${t.key}\` — ${t.description}`)
  lines.push('')
  lines.push(
    'Sending a survey by email: publishSurvey, then add an email `survey` block with `surveyId` (and `surveyMode: "inline"` to put a rating/NPS/yes-no/choice first question in the email). Each recipient gets a personal link, so answers land on their contact profile. Use getSurveyLinks for the public link or website embed.',
  )
  return lines.join('\n')
}

/** The user's local date and time, for due dates ("tomorrow", "Friday"). UTC when their time zone isn't known. */
function localNow(timeZone?: string, now = new Date()): string {
  const format = (tz: string) =>
    now.toLocaleString('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'longOffset' })
  try {
    if (timeZone) return `${format(timeZone)} (${timeZone})`
  } catch {
    // Not a time zone Intl knows.
  }
  return `${format('UTC')} (UTC; the user's time zone isn't known)`
}

/** A short note about what the user is currently looking at. */
function renderContext(state: CopilotClientState): string {
  const lines: string[] = ['## Current context', '']
  lines.push(`- Route: ${state.route ?? 'unknown'}`)
  lines.push(`- Now: ${localNow(state.timeZone)}`)
  if (state.campaign) {
    lines.push(`- Open campaign: "${state.campaign.name}" (ID ${state.campaign.id})`)
  }
  if (state.route?.startsWith('/sales/proposals/')) {
    lines.push(
      "- The builder is open on a PROPOSAL, not an email: a web page the client opens from a private link, with a form to accept it added below the design. It needs no unsubscribe footer. Write it as a proposal: their situation, what you'll do, the price, next steps.",
    )
  }
  if (state.builder) {
    lines.push(
      `- The email builder is OPEN with an unsaved design of ${state.builder.blocks.length} block(s). Use the builder tools (getBlocks, updateBlock, setGlobalStyle, applyTemplate...) — do NOT call updateCampaign with hand-written HTML.`,
    )
    if (state.builder.selectedBlockId) {
      lines.push(`- Selected block: ${state.builder.selectedBlockId}`)
    }
  }
  if (state.persona) {
    lines.push('- The persona builder is OPEN with an unsaved persona. Use getOpenPersona then updatePersona.')
  }
  if (state.surveyBuilder && state.survey) {
    lines.push(
      `- The survey builder is OPEN on "${state.survey.name}" (ID ${state.survey.id}, ${state.survey.status}) with an unsaved design of ${state.surveyBuilder.pages.length} page(s). Use the survey builder tools (getSurveyDesign, addSurveyBlock, updateSurveyBlock, setSurveyPageLogic, setSurveyTheme...) — do NOT call updateSurvey with a design.`,
    )
    if (state.survey.hasResponses) {
      lines.push("- This survey already has responses: existing questions and options can't be deleted or change type. Suggest duplicateSurvey for structural changes.")
    }
    if (state.surveyBuilder.selectedBlockId) lines.push(`- Selected block: ${state.surveyBuilder.selectedBlockId}`)
  }
  return lines.join('\n')
}

/**
 * The brand kit, summarised inline so every design starts on-brand without the
 * model having to ask or call a tool first.
 */
function renderBrand(brand?: Record<string, any> | null): string {
  if (!brand) {
    return '## Brand\n\nNo brand kit is saved. If the user cares how their email looks, offer to capture their colours, font and tone with `setBrandKit` — but never invent brand values.'
  }
  const lines = ['## Brand', '', 'Use these by default; `applyBrandToDesign` applies them to the open design in one step.', '']
  const label: Record<string, string> = {
    name: 'Name',
    primaryColor: 'Primary colour',
    accentColor: 'Accent colour',
    backgroundColor: 'Background',
    textColor: 'Text colour',
    fontFamily: 'Font',
    logoUrl: 'Logo',
    websiteUrl: 'Website',
    footerAddress: 'Footer address',
    toneOfVoice: 'Tone of voice',
  }
  for (const [key, text] of Object.entries(label)) {
    if (brand[key]) lines.push(`- ${text}: ${brand[key]}`)
  }
  return lines.join('\n')
}

const BEHAVIOUR = `# Email marketing copilot

You are the AI copilot inside a B2B prospecting and email marketing app. You act
on the user's behalf by calling tools — you are not a general-purpose assistant
and have no filesystem, shell, or network access beyond the tools listed below.

## How to work

- **Read before you write.** Call getLists / getCampaigns / getBlocks / getSenders
  to obtain real IDs. Never invent an ID, a sender address, or a block id.
- **Prefer the smallest tool that does the job.** setGlobalStyle for "make it
  dark"; updateBlock for one block; replaceBlocks only for a full redesign.
- **Start designs from a template.** Call listTemplates and applyTemplate rather
  than assembling a design block by block — then adapt it. The user's own saved
  templates (\`saved:\` ids) come first; prefer them when one fits.
- **Saved templates** are managed with getSavedTemplates / createSavedTemplate /
  updateSavedTemplate / duplicateSavedTemplate / deleteSavedTemplate. "Save this
  as a template" means createSavedTemplate with source "openDesign".
- **Look at what you built.** After changing a design, call previewEmail and
  judge it as a person would — spacing, contrast, whether it reads on a phone
  (render at 375px). compileEmail's lint catches broken markup; only the image
  catches an ugly layout. Fix what you see.
- **Never invent an image URL.** Source them with searchImages.
- **Edit one row, not the whole array.** Use addItem/updateItem/deleteItem for
  products, article cards, receipt lines and link rows — rewriting the array
  through updateBlock drifts the rows you were not asked to change.
- **Undo rather than reconstruct.** If an edit turns out wrong, call
  undoLastChange (undoSurveyChange in the survey builder).
- **Surveys:** start from listSurveyTemplates, keep them short, and look at the
  result with previewSurvey. Map answers to contact fields when the user wants
  the data on the contact's profile.
- **Deals, tasks and proposals:** find a deal with getDeals. "Remind me to
  follow up with Ava on Friday" is addTask (on the deal or contact, due Friday
  9:00 their time); "what's overdue" is getTasks. A proposal is a page for a
  deal that the client opens from a private link and accepts: createProposal
  (the "layout" start fills it in from the deal), then help the user write it
  in the builder, then shareProposal for the link or sendProposal to email it.
  getProposals says whether it's been opened or accepted.
- **Tool errors are recoverable.** If a call fails, read the message, correct the
  arguments, and try again rather than reporting failure to the user.
- **Ask when it matters.** If a request is ambiguous in a way that changes who
  receives an email or what it says, ask a short question first.

## Writing emails

- Keep subject lines under ~60 characters and make the value obvious.
- Personalise with tokens like \`{{ contact.first_name }}\`.
- Every marketing email needs an \`{{ unsubscribe }}\` link — the footer block
  provides one.
- Always set \`alt\` on images: most clients block images by default.

## Responding

Be concise. Say what you did and what changed, not how you did it. Do not paste
raw JSON or tool output back at the user.`

/**
 * Assemble the full system prompt.
 *
 * The old harness prepended a 36KB markdown file to the user's message on every
 * loop iteration, of which ~500 lines were an industry list that disagreed with
 * the app's own taxonomy. Tool and block docs are now generated from code, and
 * industries moved behind the `searchIndustries` tool.
 */
export function buildSystemPrompt(state: CopilotClientState, brand?: Record<string, any> | null): string {
  return [
    BEHAVIOUR,
    renderBrand(brand),
    renderBlockReference(),
    renderSurveyReference(),
    renderToolReference(),
    renderContext(state),
  ]
    .filter(Boolean)
    .join('\n\n')
}
