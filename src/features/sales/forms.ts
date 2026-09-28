/** Text inputs and selects on the sales pages and forms. */
export const FIELD_CLASS =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40'

/** "250" → 250, "" → null. */
export function parseHeadcount(raw: string): number | null {
  const n = parseInt(raw.replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

/** "12 Mar 2026". */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
