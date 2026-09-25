import type { EmailBlock, GlobalStyle } from './types'

/** Sub-arrays of a block that the UI edits row by row. */
export type BlockCollection = 'items' | 'links' | 'socials' | 'summaryRows'

export function newItemId(prefix = 'i'): string {
  return `${prefix}_` + Math.random().toString(36).slice(2, 11)
}

export interface BuilderDesign {
  blocks: EmailBlock[]
  globalStyle: GlobalStyle
}

export interface BuilderAction {
  action: string
  args: any
}

/** Ids only need to be unique within a design. */
export function newBlockId(): string {
  return 'b_' + Math.random().toString(36).slice(2, 11)
}

/**
 * Apply one copilot mutation to a design.
 *
 * Pure, and shared by both sides: the browser uses it to update the live canvas,
 * and the server uses it to keep its copy of the design current *within* a turn.
 * Without the server half, `getBlocks` kept replaying the design as it was when
 * the turn started, so the copilot would write, read back unchanged state, and
 * loop — re-applying a template and eventually reporting failure.
 */

/**
 * `section` blocks nest other blocks in `children`, so every lookup has to walk
 * the tree rather than just the top level. Without this, editing or deleting a
 * block inside a section either failed with a confusing "no such id" or — worse
 * for delete — reported success and silently changed nothing.
 */
function mapTree(blocks: EmailBlock[], fn: (b: EmailBlock) => EmailBlock): EmailBlock[] {
  return blocks.map(block => {
    const next = fn(block)
    return next.children ? { ...next, children: mapTree(next.children, fn) } : next
  })
}

function removeFromTree(blocks: EmailBlock[], id: string): EmailBlock[] {
  return blocks
    .filter(b => b.id !== id)
    .map(b => (b.children ? { ...b, children: removeFromTree(b.children, id) } : b))
}

/** Swap a block with its neighbour, within whichever sibling list holds it. */
function moveInTree(blocks: EmailBlock[], id: string, direction: 'up' | 'down'): EmailBlock[] {
  const index = blocks.findIndex(b => b.id === id)
  if (index !== -1) {
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= blocks.length) return blocks
    const next = [...blocks]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  }
  return blocks.map(b => (b.children ? { ...b, children: moveInTree(b.children, id, direction) } : b))
}

/** Insert into a section's children when `parentId` is given, else at top level. */
function insertInTree(
  blocks: EmailBlock[],
  block: EmailBlock,
  index: number | undefined,
  parentId?: string,
): EmailBlock[] {
  if (!parentId) {
    const next = [...blocks]
    next.splice(typeof index === 'number' ? Math.max(0, Math.min(next.length, index)) : next.length, 0, block)
    return next
  }
  return blocks.map(b => {
    if (b.id === parentId) {
      const children = [...(b.children ?? [])]
      children.splice(
        typeof index === 'number' ? Math.max(0, Math.min(children.length, index)) : children.length,
        0,
        block,
      )
      return { ...b, children }
    }
    return b.children ? { ...b, children: insertInTree(b.children, block, index, parentId) } : b
  })
}

/** Every block id in the design, including nested ones. */
export function collectBlockIds(blocks: EmailBlock[]): string[] {
  return blocks.flatMap(b => [b.id, ...(b.children ? collectBlockIds(b.children) : [])])
}

/** Find a block anywhere in the tree. */
export function findBlock(blocks: EmailBlock[], id: string): EmailBlock | undefined {
  for (const b of blocks) {
    if (b.id === id) return b
    const hit = b.children ? findBlock(b.children, id) : undefined
    if (hit) return hit
  }
  return undefined
}

/**
 * Edit one row of a block's sub-array (`items`, `links`, `socials`,
 * `summaryRows`) without rewriting the whole thing.
 *
 * The UI edits these row by row; the copilot previously had to resend the
 * entire array through `updateBlock`, which meant reconstructing rows it was
 * never asked to touch — the most common way it quietly damaged a design.
 */
function editCollection(
  block: EmailBlock,
  collection: BlockCollection,
  fn: (rows: any[]) => any[],
): EmailBlock {
  const rows = ((block as any)[collection] ?? []) as any[]
  return { ...block, [collection]: fn([...rows]) } as EmailBlock
}

export function applyBuilderAction(design: BuilderDesign, { action, args }: BuilderAction): BuilderDesign {
  switch (action) {
    case 'applyTemplate':
      return {
        blocks: args.blocks ?? [],
        globalStyle: { ...design.globalStyle, ...(args.globalStyle ?? {}) },
      }

    case 'replaceBlocks':
      return { ...design, blocks: args.blocks ?? [] }

    case 'setGlobalStyle':
      return { ...design, globalStyle: { ...design.globalStyle, ...(args.updates ?? {}) } }

    case 'updateBlock':
      return {
        ...design,
        blocks: mapTree(design.blocks, b =>
          b.id === args.id
            ? { ...b, ...args.updates, style: { ...b.style, ...args.updates?.style } }
            : b,
        ),
      }

    case 'addBlock': {
      const block: EmailBlock = { id: args.block?.id ?? newBlockId(), ...args.block }
      return { ...design, blocks: insertInTree(design.blocks, block, args.index, args.parentId) }
    }

    case 'deleteBlock':
      return { ...design, blocks: removeFromTree(design.blocks, args.id) }

    case 'moveBlock':
      return { ...design, blocks: moveInTree(design.blocks, args.id, args.direction) }

    case 'restoreDesign':
      // Used by undo: swap the whole design back to a prior snapshot.
      return {
        blocks: args.blocks ?? design.blocks,
        globalStyle: args.globalStyle ?? design.globalStyle,
      }

    case 'addItem':
      return {
        ...design,
        blocks: mapTree(design.blocks, b =>
          b.id === args.blockId
            ? editCollection(b, args.collection ?? 'items', rows => {
                const row = { id: args.item?.id ?? newItemId(), ...args.item }
                rows.splice(
                  typeof args.index === 'number' ? Math.max(0, Math.min(rows.length, args.index)) : rows.length,
                  0,
                  row,
                )
                return rows
              })
            : b,
        ),
      }

    case 'updateItem':
      return {
        ...design,
        blocks: mapTree(design.blocks, b =>
          b.id === args.blockId
            ? editCollection(b, args.collection ?? 'items', rows =>
                rows.map(r => (r.id === args.itemId ? { ...r, ...args.updates } : r)),
              )
            : b,
        ),
      }

    case 'deleteItem':
      return {
        ...design,
        blocks: mapTree(design.blocks, b =>
          b.id === args.blockId
            ? editCollection(b, args.collection ?? 'items', rows => rows.filter(r => r.id !== args.itemId))
            : b,
        ),
      }

    case 'moveItem':
      return {
        ...design,
        blocks: mapTree(design.blocks, b =>
          b.id === args.blockId
            ? editCollection(b, args.collection ?? 'items', rows => {
                const i = rows.findIndex(r => r.id === args.itemId)
                if (i === -1) return rows
                const target = args.direction === 'up' ? i - 1 : i + 1
                if (target < 0 || target >= rows.length) return rows
                ;[rows[i], rows[target]] = [rows[target], rows[i]]
                return rows
              })
            : b,
        ),
      }

    default:
      return design
  }
}
