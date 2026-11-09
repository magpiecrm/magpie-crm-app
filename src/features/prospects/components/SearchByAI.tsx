import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { queryKeys } from '../../../queryKeys'
import { personaDraftStatusFn, suggestSearchFn } from '../../../server/functions'
import { websiteUrlInput } from '../../../server/prospecting/personaInput'
import type { PersonaCriteria } from '../types'
import { CriteriaChips } from './CriteriaChips'

// "Prospect search by AI": the AI reads the workspace's own website and
// suggests a people search (server/prospecting/searchSuggest.ts). Apply fills
// Prospect Search's filters with it; nothing is searched until the user
// presses Search, since searches cost credits.

/** The button, shown only where the AI can read a website (Claude's web tools), and its dialog. */
export function SearchByAI({ onApply }: { onApply: (criteria: PersonaCriteria) => void }) {
  const [open, setOpen] = useState(false)
  // Shared with the Personas page's Draft with AI: whether the AI can be used, and the brand kit's website.
  const { data: status } = useQuery({ queryKey: queryKeys.prospects.personaDraftStatus(), queryFn: () => personaDraftStatusFn() })
  const usable = Boolean(status?.ai.ok && status.ai.web)
  if (!status || (!usable && !open)) return null
  return (
    <>
      <Button size="sm" variant="outline" leftIcon={<Sparkles className="w-3.5 h-3.5" />} onClick={() => setOpen(true)} aria-label="Prospect search by AI">
        <span className="hidden sm:inline">Prospect search by AI</span>
        <span className="sm:hidden">AI</span>
      </Button>
      <SearchByAIDialog
        isOpen={open}
        onClose={() => setOpen(false)}
        websiteUrl={status.websiteUrl}
        onApply={(criteria) => {
          onApply(criteria)
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
  onApply,
}: {
  isOpen: boolean
  onClose: () => void
  websiteUrl: string
  onApply: (criteria: PersonaCriteria) => void
}) {
  const [website, setWebsite] = useState(websiteUrl)
  const [websiteError, setWebsiteError] = useState<string | null>(null)
  useEffect(() => {
    if (isOpen) setWebsite((w) => w || websiteUrl)
  }, [isOpen, websiteUrl])

  // Kept while the page is open, so closing and coming back doesn't mean asking (and paying) again.
  const suggest = useMutation({ mutationFn: (url: string) => suggestSearchFn({ data: { websiteUrl: url } }) })
  const suggestion = suggest.isPending ? null : suggest.data

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    // Checked here too, for the message: the server's own check comes back as raw issues.
    const url = websiteUrlInput.safeParse(website)
    if (!url.success) {
      setWebsiteError(url.error.issues[0]?.message ?? "That doesn't look like a website address")
      return
    }
    setWebsiteError(null)
    suggest.mutate(url.data)
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Prospect search by AI"
      description="The AI reads your website, works out what you sell and who buys it, and suggests who to search for. Only your website goes to it. You can change the filters before you search, and nothing is searched until you do."
      className="sm:max-w-xl"
    >
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <DialogBody className="space-y-4">
        <Field label="Your website" error={websiteError}>
          <input
            className={INPUT_CLASS}
            value={website}
            onChange={(e) => {
              setWebsite(e.target.value)
              setWebsiteError(null)
            }}
            placeholder="e.g. acme.com"
            disabled={suggest.isPending}
          />
        </Field>
        {suggest.isPending && <Notice>Reading your website. This takes a few minutes; you can close this meanwhile.</Notice>}
        {suggest.isError && <Notice level="error">{(suggest.error as Error).message}</Notice>}

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
          {suggestion && !suggest.isPending ? (
            <>
              <Button type="submit" variant="ghost" className="sm:mr-auto" disabled={!website.trim()} leftIcon={<Sparkles className="w-4 h-4" />}>
                Suggest again
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={() => onApply(suggestion.criteria)}>
                Apply filters
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" isLoading={suggest.isPending} disabled={!website.trim()} leftIcon={<Sparkles className="w-4 h-4" />}>
                Suggest a search
              </Button>
            </>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  )
}
