/**
 * A reusable email design saved by the user.
 *
 * `html` is compiled builder output, including the embedded `BLOCKS_DATA`
 * block model — the same shape as a campaign's `html_content` — so a template
 * opens in the builder as-is and seeds a campaign with a plain string copy.
 */
export interface EmailTemplate {
  id: string
  name: string
  description: string
  html: string
  created_at: string
  updated_at: string
}
