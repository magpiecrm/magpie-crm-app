import { useRef, useState } from 'react'
import { Check, Code2, Copy, ExternalLink, FileCode2, Link2, Webhook } from 'lucide-react'
import { Dialog, DialogBody, useMoreBelow } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import type { PublicForm } from '../model'
import { hostedUrl, iframeSnippet, plainHtmlSnippet } from '../render'

type Tab = 'embed' | 'link' | 'html' | 'api'

const TABS: Array<{ id: Tab; label: string; icon: typeof Code2 }> = [
  { id: 'embed', label: 'Embed', icon: Code2 },
  { id: 'link', label: 'Link', icon: Link2 },
  { id: 'html', label: 'HTML', icon: FileCode2 },
  { id: 'api', label: 'API', icon: Webhook },
]

/** Something to copy, with one Copy button that says when it's done. */
export function CopyBlock({ value, label, rows = 6, mono = true }: { value: string; label: string; rows?: number; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  const pre = useRef<HTMLPreElement>(null)
  const more = useMoreBelow(pre)
  const copy = async () => {
    await navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <Button variant="secondary" size="sm" onClick={copy} leftIcon={copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />} aria-live="polite">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="relative">
        {/* Long tokens (addresses) break only where they must, so the code stays readable on a phone. */}
        <pre
          ref={pre}
          className={`custom-scrollbar overflow-auto whitespace-pre-wrap rounded-md-s border border-border bg-muted/50 px-3 py-2.5 pb-3 text-[13px] leading-relaxed text-foreground [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${mono ? 'font-mono' : ''}`}
          style={{ maxHeight: `${rows * 1.65 + 1.4}em` }}
          tabIndex={0}
          aria-label={label}
        >
          {value}
        </pre>
        {more && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-px bottom-px flex h-10 items-end justify-center rounded-b-md-s bg-gradient-to-t from-muted via-muted/80 to-transparent pb-1 text-xs font-medium text-muted-foreground">
            Scroll for more
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Every way to put a form in front of people: the embed (recommended, it
 * follows the builder's changes), a link to its own page, plain HTML to style
 * yourself, and the endpoint for your own code. `ready` is after a new form is
 * first saved.
 */
export function ShareDialog({ form, onClose, ready = false }: { form: PublicForm; onClose: () => void; ready?: boolean }) {
  const [tab, setTab] = useState<Tab>('embed')
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const url = hostedUrl(form.id, origin)
  const example = JSON.stringify(Object.fromEntries(form.fields.map((f) => [f.key, f.type === 'email' ? 'priya@example.com' : f.type === 'checkbox' ? true : f.type === 'multiselect' ? [f.options?.[0] ?? ''] : f.type === 'select' ? f.options?.[0] ?? '' : f.key === 'first_name' ? 'Priya' : f.key === 'last_name' ? 'Raman' : '…'])), null, 2)
  const required = form.fields.filter((f) => f.required).map((f) => f.key)

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={ready ? 'Your form is ready' : `Share “${form.name}”`}
      description={ready ? `Put “${form.name}” on your website, or share its link.` : 'Put it on your website, or share its link.'}
      className="sm:max-w-2xl"
    >
      <DialogBody className="flex flex-col gap-5">
        <div role="tablist" aria-label="Ways to share" className="grid grid-cols-4 gap-1 rounded-md-s bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`share-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`share-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md-xs px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                tab === t.id ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(17_19_22/0.08)] dark:bg-white/10' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <t.icon className="h-4 w-4 shrink-0 max-[380px]:hidden" aria-hidden />
              {t.label}
            </button>
          ))}
        </div>

        {form.paused && <Notice level="warning" title="This form is paused">It shows on your site, but won't take submissions until you resume it.</Notice>}

        <div role="tabpanel" id={`share-panel-${tab}`} aria-labelledby={`share-tab-${tab}`} className="flex flex-col gap-4">
          {tab === 'embed' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Paste this into your page where the form should go. It fills the width it's given and grows to fit. Changes you save in the builder show up on your site
                straight away, without pasting it again.
              </p>
              <CopyBlock label="Embed code" value={iframeSnippet(form.id, origin, form.name)} rows={5} />
              <p className="text-[13px] text-muted-foreground">Works on WordPress, Webflow, Squarespace, Wix and plain HTML: use their "Custom HTML" or "Embed" block.</p>
            </>
          )}
          {tab === 'link' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">The form on a page of its own. Share it in an email, a post, or anywhere you can't embed.</p>
              <CopyBlock label="Link" value={url} rows={2} />
              <div>
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                  <ExternalLink className="h-4 w-4" aria-hidden /> Open the form's page
                </a>
              </div>
            </>
          )}
          {tab === 'html' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                The form as plain HTML, to style with your own CSS (its look is under <code className="rounded bg-muted px-1 font-mono text-[12.5px]">.mf</code>). It's a copy of the
                form as it is now, so paste it again if you change the fields.
              </p>
              <CopyBlock label="HTML" value={plainHtmlSnippet(form, origin)} rows={9} />
            </>
          )}
          {tab === 'api' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Send submissions from your own code: a POST of JSON (or a normal form post) to this address. {required.length > 0 && <>Required: {required.join(', ')}.</>}
              </p>
              <CopyBlock label="Endpoint" value={`${origin}/api/form-submit/${form.id}`} rows={2} />
              <CopyBlock label="Example body" value={example} rows={8} />
            </>
          )}
        </div>
      </DialogBody>
    </Dialog>
  )
}
