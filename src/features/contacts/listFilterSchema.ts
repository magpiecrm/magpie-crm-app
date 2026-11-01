import { z } from 'zod'
import type { FilterOp } from './contactFilters'

/**
 * Filters as they arrive at the server. Only their shape: whether each can be
 * applied depends on the workspace's fields (`filterProblems`), and one that
 * can't is refused there, whole, with a reason.
 */
export const listFiltersSchema = z
  .array(
    z.object({
      id: z.string().max(120),
      field: z.string().min(1).max(120),
      op: z
        .string()
        .max(40)
        .transform((op) => op as FilterOp),
      value: z.string().max(500),
      values: z.array(z.string().max(200)).max(200).optional(),
    }),
  )
  .max(30)
