import type { StarterTemplate } from '../email-builder/templates/starters'
import { compileHTML } from '../email-builder/utils/compiler'
import { DEFAULT_GLOBAL_STYLE } from '../email-builder/utils/design'

const compiled = new Map<string, string>()

/** A starter's email as the builder would compile it, made once per page load. */
export function starterHtml(starter: StarterTemplate): string {
  let html = compiled.get(starter.id)
  if (html === undefined) {
    html = compileHTML(starter.build(), { ...DEFAULT_GLOBAL_STYLE, ...starter.globalStyle })
    compiled.set(starter.id, html)
  }
  return html
}

/** The person a preview is addressed to. */
const SAMPLE: Record<string, string> = {
  first_name: 'Alex',
  firstname: 'Alex',
  last_name: 'Morgan',
  lastname: 'Morgan',
  company: 'Northwind',
  email: 'alex@example.com',
}

/**
 * The email with its contact tags filled in for a sample person, so a preview
 * reads "Welcome aboard, Alex" rather than showing the raw tag. Only for
 * looking at: sends fill tags on the server (`server/mergeTags.ts`).
 */
export function withSampleValues(html: string): string {
  return html.replace(
    /\{\{(?:\s|&nbsp;)*contact\.([a-z_]+)(?:\s|&nbsp;)*(?:\|[^{}]*)?\}\}/gi,
    (tag, key: string) => SAMPLE[key.toLowerCase()] ?? tag,
  )
}
