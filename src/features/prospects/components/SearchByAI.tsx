import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Sparkles } from 'lucide-react'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { personaDraftStatusFn } from '../../../server/functions'
import { websiteUrlInput } from '../../../server/prospecting/personaInput'
import type { PersonaCriteria } from '../types'
import { useSearchSuggestion, type SearchSuggestionState } from '../useAiRun'
import { CriteriaChips } from './CriteriaChips'
import { hostOf } from './DraftPersonasDialog'

// "Prospect search by AI": the AI reads the workspace's own website and
// suggests a people search (server/prospecting/searchSuggest.ts). Apply fills
// Prospect Search's filters with it; nothing is searched until the user
// presses Search, since searches cost credits. It runs on the server, so the
// dialog can be closed and the page left while it does: the suggestion waits
// until it's applied or dismissed.

/** The button, shown only where the AI can read a website (Claude's web tools), and its dialog. */
export function SearchByAI({ onApply }: { onApply: (criteria: PersonaCriteria) => void }) {
  const [open, setOpen] = useState(false)
  // Shared with the Personas page's Draft with AI: whether the AI can be used, and the brand kit's website.
  const { data: status } = useQuery({ queryKey: queryKeys.prospects.personaDraftStatus(), queryFn: () => personaDraftStatusFn() })
  const suggestion = useSearchSuggestion()
  const { run } = suggestion
  const usable = Boolean(status?.ai.ok && status.ai.web)
  if (!status || (!usable && !open && !run)) return null
  const running = run?.status === 'running'
  const ready = run?.status === 'done'
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        leftIcon={running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        onClick={() => setOpen(true)}
        aria-label={running ? 'Prospect search by AI: suggesting a search' : ready ? 'Prospect search by AI: a suggestion is ready' : 'Prospect search by AI'}
      >
        <span className="hidden sm:inline">{running ? 'Suggesting a search…' : 'Prospect search by AI'}</span>
        <span className="sm:hidden">AI</span>
        {ready && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent shrink-0" />}
      </Button>
      <SearchByAIDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        websiteUrl={status.websiteUrl}
        suggestion={suggestion}
        onApply={(criteria) => {
          onApply(criteria)
          if (run) suggestion.dismiss.mutate(run.id)
          setOpen(false)
        }}
      />
    </>
  )
}

function SearchByAIDialog({
  isOpen,
  onClose,
  websiteUrl,
  suggestion: state,
  onApply,
}: {
  isOpen: boolean
  onClose: () => void
  websiteUrl: string
  suggestion: SearchSuggestionState
  onApply: (criteria: PersonaCriteria) => void
}) {
  const { run, start, dismiss, lost } = state
  const running = run?.status === 'running'
  const suggestion = run?.status === 'done' ? (run.result ?? null) : null
  const [website, setWebsite] = useState(websiteUrl)
  const [websiteError, setWebsiteError] = useState<string | null>(null)
  // Opened onto a suggestion: the website it came from, to suggest again from.
  useEffect(() => {
    if (!isOpen) return
    if (run) setWebsite(run.input.websiteUrl)
    else setWebsite((w) => w || websiteUrl)
  }, [isOpen, run?.id, websiteUrl])

  const close = () => {
    start.reset()
    onClose()
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    // Checked here too, for the message: the server's own check comes back as raw issues.
    const url = websiteUrlInput.safeParse(website)
    if (!url.success) {
      setWebsiteError(url.error.issues[0]?.message ?? "That doesn't look like a website address")
      return
    }
    setWebsiteError(null)
    start.mutate({ websiteUrl: url.data })
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title="Prospect search by AI"
      description="The AI reads your website, works out what you sell and who buys it, and suggests who to search for. Only your website goes to it. You can change the filters before you search, and nothing is searched until you do."
      className="sm:max-w-xl"
    >
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <DialogBody className="space-y-4">
        <Field label="Your website" error={websiteError}>
          <input
            className={INPUT_CLASS}
            value={running ? run.input.websiteUrl : website}
            onChange={(e) => {
              setWebsite(e.target.value)
              setWebsiteError(null)
            }}
            placeholder="e.g. acme.com"
            disabled={running}
          />
        </Field>
        {running && (
          <Notice title={`Reading ${hostOf(run.input.websiteUrl)}`}>
            This takes a few minutes. You can close this and carry on, even leave this page: the suggestion will wait here, and the bell will tell you when it's ready.
          </Notice>
        )}
        {lost && !run && <Notice level="warning">The suggestion stopped before it finished. Suggest a search again.</Notice>}
        {run?.status === 'failed' && <Notice level="error">{run.error}</Notice>}
        {start.isError && <Notice level="error">{(start.error as Error).message}</Notice>}

        {suggestion && (
          <div className="pt-4 border-t border-border space-y-4">
            <div className="card border border-border rounded-md-m p-4 space-y-3">
              <p className="text-sm text-foreground">{suggestion.why}</p>
              <CriteriaChips criteria={suggestion.criteria} />
            </div>
            <p className="text-[13px] text-muted-foreground">Apply puts these in the filters, in place of the ones there now. Change them if you like, then search.</p>
          </div>
        )}
        </DialogBody>
        <DialogFooter>
          {running ? (
            <>
              <Button type="button" variant="ghost" className="sm:mr-auto" onClick={() => dismiss.mutate(run.id)}>
                Stop
              </Button>
              <Button type="button" onClick={close}>
                Close
              </Button>
            </>
          ) : suggestion ? (
            <>
              <Button type="submit" variant="ghost" className="sm:mr-auto" isLoading={start.isPending} disabled={!website.trim()} leftIcon={<Sparkles className="w-4 h-4" />}>
                Suggest again
              </Button>
              <Button type="button" variant="secondary" onClick={close}>
                Close
              </Button>
              <Button type="button" onClick={() => onApply(suggestion.criteria)}>
                Apply filters
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" isLoading={start.isPending} disabled={!website.trim()} leftIcon={<Sparkles className="w-4 h-4" />}>
                Suggest a search
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  )
}
