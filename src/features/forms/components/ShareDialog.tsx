import { useRef, useState } from 'react'
import { Check, Code2, Copy, ExternalLink, FileCode2, Link2, Webhook } from 'lucide-react'
import { Dialog, DialogBody, DialogFooter, useMoreBelow } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import type { PublicForm } from '../model'
import { hostedUrl, iframeSnippet, plainHtmlSnippet, popupSnippet } from '../render'
import { Select } from '../../../components/ui/Select'
import { INPUT_CLASS } from '../../../components/ui/Field'

type Tab = 'embed' | 'link' | 'html' | 'api'

const TABS: Array<{ id: Tab; label: string; short: string; icon: typeof Code2 }> = [
  { id: 'embed', label: 'Embed code', short: 'Embed', icon: Code2 },
  { id: 'link', label: 'Link', short: 'Link', icon: Link2 },
  { id: 'html', label: 'Plain HTML', short: 'HTML', icon: FileCode2 },
  { id: 'api', label: 'API', short: 'API', icon: Webhook },
]

/** Something to copy, with one Copy button that says when it's done. */
export function CopyBlock({ value, label, rows, mono = true, primary = false, wrap = false }: { value: string; label: string; /** Lines before it scrolls; all of it when left out. */ rows?: number; mono?: boolean; /** The dialog's main action. */ primary?: boolean; /** Wrap long lines (a link) rather than scroll sideways (code). */ wrap?: boolean }) {
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
        <Button variant={primary ? 'primary' : 'secondary'} size="sm" onClick={copy} leftIcon={copied ? <Check className={`h-3.5 w-3.5 ${primary ? '' : 'text-emerald-600 dark:text-emerald-400'}`} /> : <Copy className="h-3.5 w-3.5" />} aria-live="polite">
          {copied ? 'Copied' : primary ? 'Copy code' : 'Copy'}
        </Button>
      </div>
      <div className="relative">
        {/* Long tokens (addresses) break only where they must, so the code stays readable on a phone. */}
        <pre
          ref={pre}
          className={`custom-scrollbar overflow-auto ${wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'} rounded-md-s border border-border bg-muted/50 px-3 py-2.5 text-[13px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${mono ? 'font-mono' : ''}`}
          style={rows ? { maxHeight: `${rows * 1.65 + 1.4}em` } : undefined}
          tabIndex={0}
          aria-label={label}
        >
          {value}
        </pre>
        {more && <div aria-hidden="true" className="pointer-events-none absolute inset-x-px bottom-px h-6 rounded-b-md-s bg-gradient-to-t from-muted to-transparent" />}
      </div>
      {more && <p className="text-xs text-muted-foreground">Scroll the box to see all of it, or copy it whole.</p>}
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
  const [kind, setKind] = useState<'inline' | 'popup'>('inline')
  const [delay, setDelay] = useState(8)
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
              <t.icon className="h-4 w-4 shrink-0 max-sm:hidden" aria-hidden />
              <span className="sm:hidden">{t.short}</span>
              <span className="max-sm:hidden">{t.label}</span>
            </button>
          ))}
        </div>

        {form.paused && <Notice level="warning" title="This form is paused">It shows on your site, but won't take submissions until you resume it.</Notice>}

        <div role="tabpanel" id={`share-panel-${tab}`} aria-labelledby={`share-tab-${tab}`} className="flex flex-col gap-4">
          {tab === 'embed' && (
            <>
              <div role="radiogroup" aria-label="How it shows" className="grid gap-2 sm:grid-cols-2">
                {([
                  ['inline', 'In the page', 'Where you paste it, as wide as the space it’s in.'],
                  ['popup', 'As a pop-up', 'Over the page after a few seconds, once per visitor.'],
                ] as const).map(([id, title, detail]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={kind === id}
                    onClick={() => setKind(id)}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md-s border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${kind === id ? 'border-accent bg-accent/5' : 'border-border hover:bg-muted'}`}
                  >
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${kind === id ? 'border-accent' : 'border-muted-foreground/50'}`}>
                      {kind === id && <span className="h-2 w-2 rounded-full bg-accent" />}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{title}</span>
                      <span className="text-[13px] leading-snug text-muted-foreground">{detail}</span>
                    </span>
                  </button>
                ))}
              </div>
              {kind === 'popup' && (
                <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  Show it
                  <Select className={`${INPUT_CLASS} !w-auto`} value={delay} onChange={(e) => setDelay(Number(e.target.value))} aria-label="When the pop-up shows">
                    {[3, 8, 15, 30, 60].map((n) => <option key={n} value={n}>{n} seconds after the page opens</option>)}
                  </Select>
                </label>
              )}
              <p className="text-sm leading-relaxed text-muted-foreground">
                {kind === 'inline'
                  ? 'Paste it into your page where the form should go. It grows to fit the form.'
                  : 'Paste it once into your page, anywhere. Closing or sending it stops it showing again for 30 days.'}{' '}
                Changes you save in the builder show up on your site straight away, without pasting it again.
              </p>
              <CopyBlock primary label="Embed code" value={kind === 'inline' ? iframeSnippet(form.id, origin, form.name) : popupSnippet(form, origin, delay)} />
              <p className="text-[13px] leading-relaxed text-muted-foreground">Works on WordPress, Webflow, Squarespace, Wix and plain HTML: use their "Custom HTML" or "Embed" block.</p>
            </>
          )}
          {tab === 'link' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">The form on a page of its own. Share it in an email, a post, or anywhere you can't embed.</p>
              <CopyBlock primary wrap label="Link" value={url} />
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
              <CopyBlock primary label="HTML" value={plainHtmlSnippet(form, origin)} rows={9} />
            </>
          )}
          {tab === 'api' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Send submissions from your own code: a POST of JSON (or a normal form post) to this address. {required.length > 0 && <>Required: {required.join(', ')}.</>}
              </p>
              <CopyBlock wrap label="Endpoint" value={`${origin}/api/form-submit/${form.id}`} />
              <CopyBlock label="Example body" value={example} rows={10} />
            </>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open(url, '_blank', 'noopener')}>Open the form</Button>
        <Button variant="secondary" onClick={onClose}>Done</Button>
      </DialogFooter>
    </Dialog>
  )
}
