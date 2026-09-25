import { z } from 'zod'

/**
 * Resolve a mixed list of list identifiers to numeric IDs.
 *
 * The model routinely refers to lists the way a person would — "the newsletter
 * list", "Q4 Leads (ID: 3)" — so accept names and decorated strings alongside
 * plain numbers. Ported from the old `resolveListIds` in
 * `server/functions/copilot.ts`, which is why the copilot has always tolerated
 * this; keeping it means the MCP rewrite is not a regression in usability.
 */
export async function resolveListIds(input: Array<string | number>): Promise<number[]> {
  const { getLists } = await import('../../emailService')
  const { lists } = await getLists()
  const resolved: number[] = []

  for (const item of input) {
    if (typeof item === 'number' && !Number.isNaN(item)) {
      resolved.push(item)
      continue
    }

    const raw = String(item).trim()
    if (!raw) continue

    const asNumber = Number(raw)
    if (!Number.isNaN(asNumber)) {
      resolved.push(asNumber)
      continue
    }

    // "Newsletter (ID: 3)" / "ID: 3" / "ID 3"
    const idMatch = raw.match(/(?:id[:\s]+)(\d+)/i)
    if (idMatch) {
      resolved.push(Number(idMatch[1]))
      continue
    }

    const searchName = raw.replace(/\s*\(id:\s*\d+\)\s*/i, '').trim().toLowerCase()
    if (!searchName) continue

    const matched = lists.find((l: any) => {
      const name = String(l.name).toLowerCase().trim()
      return name === searchName || name.includes(searchName) || searchName.includes(name)
    })
    if (matched) resolved.push(matched.id)
  }

  return [...new Set(resolved)]
}

/**
 * Resolve a single list reference, erroring with the available names rather
 * than silently falling back. The old code defaulted to `lists[0]` when it
 * could not resolve a target, which meant a typo could send a campaign to the
 * wrong audience.
 */
export async function resolveListId(input: string | number): Promise<number> {
  const [id] = await resolveListIds([input])
  if (id === undefined) {
    const { getLists } = await import('../../emailService')
    const { lists } = await getLists()
    const names = lists.map((l: any) => `"${l.name}" (ID: ${l.id})`).join(', ')
    throw new Error(
      `No list matches ${JSON.stringify(input)}. Available lists: ${names || 'none yet'}.`,
    )
  }
  return id
}

/** Accepts a list ID or a list name; both are common in model output. */
export const listRef = z
  .union([z.number(), z.string()])
  .describe('A list ID, or the list name (e.g. "Newsletter"). Names are matched case-insensitively.')

/** A field the model may send as one value or several. */
export const stringOrArray = z.union([z.string(), z.array(z.string())])
