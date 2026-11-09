import { INPUT_CLASS } from '../../components/ui/Field'

/** Text inputs and selects on the sales pages and forms: the app's one field style. */
export const FIELD_CLASS = INPUT_CLASS

/** A field's label above it, as `Field` draws one. */
export const LABEL_CLASS = 'block text-[13px] font-medium text-foreground mb-1.5'

/** "250" → 250, "" → null. */
export function parseHeadcount(raw: string): number | null {
  const n = parseInt(raw.replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

/** "12 Mar 2026". */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
