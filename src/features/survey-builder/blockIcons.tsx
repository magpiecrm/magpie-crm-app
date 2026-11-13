import {
  AlignLeft,
  AtSign,
  Calendar,
  CheckSquare,
  ChevronDownSquare,
  CircleDot,
  Code,
  Gauge,
  Hash,
  Heading,
  Image,
  Minus,
  MoveVertical,
  Pilcrow,
  SlidersHorizontal,
  Star,
  TextCursorInput,
  ThumbsUp,
  type LucideIcon,
} from 'lucide-react'
import type { SurveyBlockType } from './types'

/** The four kinds a block can be, each with its own chip colour, as Typeform groups its question types. */
export type BlockGroup = 'text' | 'choice' | 'rating' | 'content'

export const BLOCK_GROUPS: Array<{ id: BlockGroup; label: string }> = [
  { id: 'rating', label: 'Ratings' },
  { id: 'choice', label: 'Choices' },
  { id: 'text', label: 'Text and details' },
  { id: 'content', label: 'Content' },
]

/** Icon and group for every block type, keyed by the catalogue so a new type can't be missing one. */
export const BLOCK_LOOK: Record<SurveyBlockType, { icon: LucideIcon; group: BlockGroup }> = {
  nps: { icon: Gauge, group: 'rating' },
  rating: { icon: Star, group: 'rating' },
  scale: { icon: SlidersHorizontal, group: 'rating' },
  single_choice: { icon: CircleDot, group: 'choice' },
  multiple_choice: { icon: CheckSquare, group: 'choice' },
  dropdown: { icon: ChevronDownSquare, group: 'choice' },
  yes_no: { icon: ThumbsUp, group: 'choice' },
  short_text: { icon: TextCursorInput, group: 'text' },
  long_text: { icon: AlignLeft, group: 'text' },
  email: { icon: AtSign, group: 'text' },
  number: { icon: Hash, group: 'text' },
  date: { icon: Calendar, group: 'text' },
  heading: { icon: Heading, group: 'content' },
  text: { icon: Pilcrow, group: 'content' },
  image: { icon: Image, group: 'content' },
  divider: { icon: Minus, group: 'content' },
  spacer: { icon: MoveVertical, group: 'content' },
  html: { icon: Code, group: 'content' },
}

/** Chip colours per group: a tint with a darker icon of the same hue (4.5:1 on the tint in both themes). */
const CHIP: Record<BlockGroup, string> = {
  rating: 'bg-amber-500/15 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300',
  choice: 'bg-violet-500/12 text-violet-800 dark:bg-violet-400/15 dark:text-violet-300',
  text: 'bg-sky-500/12 text-sky-800 dark:bg-sky-400/15 dark:text-sky-300',
  content: 'bg-foreground/[0.07] text-foreground/75',
}

/** A block type's icon in its group's coloured chip; `label` adds the question's number beside it ("Q3"). */
export function BlockChip({ type, label, size = 'md' }: { type: SurveyBlockType; label?: string; size?: 'sm' | 'md' }) {
  const { icon: Icon, group } = BLOCK_LOOK[type]
  const box = size === 'sm' ? 'h-6 min-w-6 gap-1 px-1 text-[11px]' : 'h-7 min-w-7 gap-1 px-1.5 text-xs'
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-md-xs font-semibold tabular-nums ${box} ${CHIP[group]}`} aria-hidden>
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      {label}
    </span>
  )
}
