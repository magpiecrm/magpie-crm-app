import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, Loader2, Sparkles } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { SpamFinding, SpamLevel, SpamPart, SpamScore, SpamStepScore } from './types'

export const SPAM_LEVEL: Record<SpamLevel, { label: string; variant: 'success' | 'warning' | 'error' }> = {
  low: { label: 'Low risk', variant: 'success' },
  medium: { label: 'Medium risk', variant: 'warning' },
  high: { label: 'High risk', variant: 'error' },
}

const PARTS: Array<[SpamPart, string]> = [
  ['content', 'The email'],
  ['sender', 'Who sends it'],
  ['recipients', 'Who it goes to'],
]

/** What the score's change would be worth for each finding. */
const weight = (f: SpamFinding) => (f.hard ? 'High' : f.points ? `+${f.points}` : 'Note')

/** Whether "Fix with AI" has anything to do: findings in the email itself that count. */
export const hasFixable = (score: SpamScore | undefined) => Boolean(score?.findings.some((f) => f.fixable && f.points > 0))

/** "Spam score 18 · Low risk", for a header or a list. */
export function SpamScoreBadge({ score, loading }: { score?: SpamScore; loading?: boolean }) {
  if (!score) return loading ? <Badge>Spam score…</Badge> : null
  const level = SPAM_LEVEL[score.level]
  return (
    <Badge variant={level.variant}>
      Spam score {score.score} · {level.label}
    </Badge>
  )
}

function Finding({ f }: { f: SpamFinding }) {
  return (
    <li className="flex gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-foreground">
          {f.step ? <span className="font-medium">Email {f.step}: </span> : null}
          {f.text}
        </p>
        <p className="text-muted-foreground">{f.fix}</p>
      </div>
      <span className={`shrink-0 pt-px text-[11px] font-medium tabular-nums ${f.hard ? 'text-destructive' : 'text-muted-foreground'}`}>{weight(f)}</span>
    </li>
  )
}

/**
 * A campaign's or sequence's spam score, before it goes out: the score, and
 * opened, what counts against it and what to change.
 */
export function SpamScoreCard({
  score,
  loading,
  error,
  defaultOpen = false,
  onFixWithAI,
  fixing,
  className = '',
}: {
  score?: SpamScore
  loading?: boolean
  error?: string | null
  defaultOpen?: boolean
  /** Shown when the copilot can run and there's something in the email to fix. */
  onFixWithAI?: () => void
  fixing?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  // Opens by itself once a score comes back that asks for it (High, in the send drawer).
  useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])
  const top = score?.findings.find((f) => f.points > 0 || f.hard)
  const level = score ? SPAM_LEVEL[score.level] : null

  return (
    <section className={`rounded-xl border border-border bg-card text-xs ${className}`} aria-label="Spam score">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!score}
        className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Spam score</span>
            {score && <span className="text-sm font-semibold tabular-nums text-foreground">{score.score}</span>}
            {level && <Badge variant={level.variant}>{level.label}</Badge>}
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Checking" />}
          </div>
          <p className="mt-0.5 truncate text-muted-foreground">
            {error
              ? `Couldn't check it: ${error}`
              : !score
                ? loading
                  ? 'Checking how likely it is to land in spam…'
                  : 'Add a design to check how likely it is to land in spam.'
                : top
                  ? top.text
                  : 'Nothing found that is likely to send it to spam.'}
          </p>
        </div>
        {score && <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && score && (
        <div className="space-y-4 border-t border-border px-4 py-3">
          {PARTS.map(([part, label]) => {
            const found = score.findings.filter((f) => f.part === part)
            if (!found.length) return null
            return (
              <div key={part}>
                <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</h4>
                <ul className="space-y-2">
                  {found.map((f) => (
                    <Finding key={`${f.code}-${f.step ?? 0}`} f={f} />
                  ))}
                </ul>
              </div>
            )
          })}
          {!score.findings.length && <p className="text-muted-foreground">Nothing found: plain words, a set-up sender and people who expect it.</p>}
          <p className="text-muted-foreground">
            This is an estimate from what can be checked here: mailbox providers make their own decisions.
            {score.senderCheck && (
              <>
                {' '}
                A{' '}
                <Link to="/settings" search={{ tab: 'warmup' }} className="text-accent hover:underline">
                  sender check
                </Link>{' '}
                shows where your mail really lands.
              </>
            )}
          </p>
          {onFixWithAI && hasFixable(score) && (
            <Button type="button" size="sm" variant="secondary" onClick={onFixWithAI} isLoading={fixing} leftIcon={<Sparkles className="h-3.5 w-3.5" />}>
              Fix with AI
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * One sequence email's score, as a chip that opens its own findings (the
 * sequence's sender and recipients are on the page's card).
 */
export function SpamStepChip({ step }: { step?: SpamStepScore }) {
  const [open, setOpen] = useState(false)
  if (!step) return null
  const level = SPAM_LEVEL[step.level]
  const counted = step.findings.filter((f) => f.points > 0 || f.hard)
  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!counted.length} className="inline-flex items-center gap-1.5 disabled:cursor-default">
        <Badge variant={level.variant}>
          Spam score {step.score} · {level.label}
        </Badge>
        {counted.length > 0 && <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && counted.length > 0 && (
        <ul className="mt-2 space-y-2 rounded-lg border border-border bg-background p-3">
          {counted.map((f) => (
            <Finding key={f.code} f={{ ...f, step: undefined }} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Before sending something likely to land in spam: the person says so first.
 * True to go ahead (always, below High).
 */
export function confirmSpamRisk(score: SpamScore | undefined, what = 'It'): boolean {
  if (score?.level !== 'high') return true
  const reasons = score.findings
    .filter((f) => f.hard || f.points > 0)
    .slice(0, 3)
    .map((f) => `• ${f.text}`)
    .join('\n')
  return window.confirm(`${what} is likely to land in spam (spam score ${score.score}):\n\n${reasons}\n\nSend anyway?`)
}
