import { useEffect, useState } from 'react'
import { Check, Plus, Sparkles } from 'lucide-react'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import type { AiAvailability } from '../../../server/copilot/availability'
import type { PersonaDraftState } from '../useAiRun'
import { CriteriaChips } from './CriteriaChips'

// The AI reads the workspace's website and suggests personas
// (server/prospecting/personaDraft.ts). It runs on the server, so this can be
// closed while it does: the drafts wait for whoever comes back, and the bell
// says when they're ready. Nothing is kept as a persona until it's added.

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function DraftPersonasDialog({
  isOpen,
  onClose,
  websiteUrl,
  ai,
  draft,
}: {
  isOpen: boolean
  onClose: () => void
  websiteUrl: string
  ai: AiAvailability
  draft: PersonaDraftState
}) {
  const { run, drafts, left, start, add, dismiss, lost } = draft
  const running = run?.status === 'running'
  const [website, setWebsite] = useState(websiteUrl)
  const [note, setNote] = useState('')
  // Opened onto a draft: its own website and note, to draft again from.
  useEffect(() => {
    if (!isOpen) return
    if (run) {
      setWebsite(run.input.websiteUrl)
      setNote(run.input.note ?? '')
    } else setWebsite((w) => w || websiteUrl)
  }, [isOpen, run?.id, websiteUrl])

  const begin = () => start.mutate({ websiteUrl: website, note: note.trim() || undefined })
  const close = () => {
    start.reset()
    add.reset()
    onClose()
  }
  const done = () => {
    if (run) dismiss.mutate(run.id)
    close()
  }

  // Reading the website takes Claude's web tools. Drafts already made can still be added.
  const blocked = !ai.ok ? ai.reason : !ai.web ? "It reads your website with Claude's web tools, so it needs an Anthropic key: add one in Settings → Copilot." : null
  if (blocked && !running && !drafts.length) {
    return (
      <Dialog isOpen={isOpen} onClose={close} title="Draft personas with AI" className="sm:max-w-md">
        <DialogBody>
          <Notice>{blocked}</Notice>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title="Draft personas with AI"
      description="The AI reads your website and suggests who to prospect: job titles, the companies they work at, and what they care about. Only your website and what you add below go to it. Nothing is saved until you add a persona."
      className="sm:max-w-2xl"
    >
      <DialogBody className="space-y-4">
        <Field label="Your website">
          <input
            className={INPUT_CLASS}
            value={running ? run.input.websiteUrl : website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="e.g. acme.com"
            disabled={running}
          />
        </Field>
        <Field label="Anything it should know" hint="Optional. For example who your best customers are, or a market you don't sell to.">
          <textarea
            className={`${INPUT_CLASS} resize-y font-[inherit]`}
            rows={2}
            maxLength={1_000}
            value={running ? (run.input.note ?? '') : note}
            onChange={(e) => setNote(e.target.value)}
            disabled={running}
            placeholder="e.g. We sell mostly to UK firms with a few hundred staff."
          />
        </Field>
        {running && (
          <Notice title={`Reading ${hostOf(run.input.websiteUrl)} since ${timeOf(run.startedAt)}`}>
            This takes a few minutes. You can close this and carry on: the drafts will wait here, and the bell will tell you when they're ready.
          </Notice>
        )}
        {lost && !run && <Notice level="warning">The draft stopped before it finished. Draft personas again.</Notice>}
        {run?.status === 'failed' && <Notice level="error">{run.error}</Notice>}
        {start.isError && <Notice level="error">{(start.error as Error).message}</Notice>}

        {drafts.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-border">
            {drafts.map((d, i) => (
              <div key={i} className="card border border-border rounded-md-m p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{d.name}</h3>
                    {d.description && <p className="text-[13px] text-muted-foreground mt-0.5">{d.description}</p>}
                  </div>
                  {run?.added?.includes(i) ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                      <Check className="w-3.5 h-3.5" /> Added
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => add.mutate([i])} disabled={add.isPending} leftIcon={<Plus className="w-3.5 h-3.5" />}>
                      Add
                    </Button>
                  )}
                </div>
                <CriteriaChips criteria={d.criteria} />
                {d.painPoints && (
                  <p className="text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground">Pain points: </span>
                    {d.painPoints}
                  </p>
                )}
                {d.valueProp && (
                  <p className="text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground">Why they'd care: </span>
                    {d.valueProp}
                  </p>
                )}
              </div>
            ))}
            {add.isError && <Notice level="error">{(add.error as Error).message}</Notice>}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        {running ? (
          <>
            <Button variant="ghost" className="sm:mr-auto" onClick={() => dismiss.mutate(run.id)}>
              Stop drafting
            </Button>
            <Button onClick={close}>Close</Button>
          </>
        ) : drafts.length > 0 ? (
          <>
            <Button
              variant="ghost"
              className="sm:mr-auto"
              onClick={begin}
              isLoading={start.isPending}
              disabled={!website.trim() || !!blocked}
              leftIcon={<Sparkles className="w-4 h-4" />}
            >
              Draft again
            </Button>
            {left.length > 0 ? (
              <>
                <Button variant="secondary" onClick={close}>
                  Close
                </Button>
                {left.length > 1 && (
                  <Button onClick={() => add.mutate(left)} isLoading={add.isPending}>
                    Add all {left.length}
                  </Button>
                )}
              </>
            ) : (
              <Button onClick={done}>Done</Button>
            )}
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={begin} isLoading={start.isPending} disabled={!website.trim()} leftIcon={<Sparkles className="w-4 h-4" />}>
              Draft personas
            </Button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  )
}
