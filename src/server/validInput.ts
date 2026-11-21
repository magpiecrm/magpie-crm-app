import type { z } from 'zod'

/**
 * Parses a server function's input against its schema, refusing with the first
 * problem in words. Use it in place of `schema.parse` where the refusal is shown
 * to someone: a ZodError's own message is the JSON of every issue.
 */
export function validInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  throw new Error(result.error.issues[0]?.message ?? "That isn't valid.")
}
