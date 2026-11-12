import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Code2, ExternalLink, KeyRound, Link2, Mail } from 'lucide-react'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import { CopyBlock } from '../../../components/ui/CopyBlock'
import type { SurveyStatus } from '../../survey-builder/types'
import { surveyEmbedCode, surveyPopupCode, surveySignedEmbedExample } from '../embed'
import { Select } from '../../../components/ui/Select'
import { INPUT_CLASS } from '../../../components/ui/Field'
import { SurveyQrCode, surveyQrUrl } from './SurveyQrCode'

type Tab = 'link' | 'email' | 'embed' | 'signed'

const TABS: Array<{ id: Tab; label: string; short: string; icon: typeof Code2 }> = [
  { id: 'link', label: 'Link', short: 'Link', icon: Link2 },
  { id: 'email', label: 'Email', short: 'Email', icon: Mail },
  { id: 'embed', label: 'Embed', short: 'Embed', icon: Code2 },
  { id: 'signed', label: 'Your app', short: 'Your app', icon: KeyRound },
]

/**
 * Every way to put a survey in front of people: its link (and a QR code of
 * it), an email campaign, an embed on a website, and a personal link from
 * your own app's server for signed-in users.
 */
export function SurveyShareDialog({ survey, onClose }: { survey: { id: string; name: string; status: SurveyStatus }; onClose: () => void }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('link')
  const [mode, setMode] = useState<'inline' | 'popup' | 'slide'>('inline')
  const [delay, setDelay] = useState(8)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const link = `${origin}/s/${survey.id}`
  const open = `${link}${survey.status === 'draft' ? '?preview=1' : ''}`

  return (
    <Dialog isOpen onClose={onClose} title={`Share “${survey.name}”`} description="Share its link or QR code, send it by email, or put it on your website." className="sm:max-w-2xl">
      <DialogBody className="flex flex-col gap-5">
        <div role="tablist" aria-label="Ways to share" className="grid grid-cols-4 gap-1 rounded-md-s bg-muted p-1">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`survey-share-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`survey-share-panel-${t.id}`}
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

        {survey.status === 'draft' && <Notice level="warning" title="This survey is a draft">Publish it first: until then its link only opens for you, as a preview.</Notice>}
        {survey.status === 'closed' && <Notice level="warning" title="This survey is closed">Its link shows that it's closed. Reopen it to take responses again.</Notice>}

        {/* One height for every tab, so the pop-up doesn't jump as they're switched. */}
        <div role="tabpanel" id={`survey-share-panel-${tab}`} aria-labelledby={`survey-share-tab-${tab}`} className="flex min-h-[19rem] flex-col gap-4">
          {tab === 'link' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Anyone with the link can answer. Answers are anonymous, unless the survey asks for an email and “Identify contacts” is on in its settings.
              </p>
              <CopyBlock primary inline copyLabel="Copy link" label="Link" value={link} />
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-foreground">QR code</span>
                <SurveyQrCode url={surveyQrUrl(origin, survey.id)} name={survey.name} />
              </div>
            </>
          )}
          {tab === 'email' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Add a <span className="font-medium text-foreground">Survey</span> block to a campaign's email and pick this survey. Everyone gets a personal link, so their answers go
                straight onto their contact. “Answer in the email” puts the first rating, NPS, yes/no or choice question in the email itself, one click to answer.
              </p>
              <div>
                <Button leftIcon={<Mail className="h-4 w-4" />} onClick={() => navigate({ to: '/marketing/campaigns' })}>
                  Go to campaigns
                </Button>
              </div>
            </>
          )}
          {tab === 'embed' && (
            <>
              <div role="radiogroup" aria-label="How it shows" className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ['inline', 'In the page', 'Where you paste it, as wide as its space.'],
                    ['popup', 'Pop-up', 'Over the page, once per visitor.'],
                    ['slide', 'Slide-in', 'In a corner, once per visitor.'],
                  ] as const
                ).map(([id, title, detail]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={mode === id}
                    onClick={() => setMode(id)}
                    className={`flex cursor-pointer flex-col gap-2 rounded-md-s border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${mode === id ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-border hover:bg-muted'}`}
                  >
                    <ModeSketch mode={id} />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">{title}</span>
                      <span className="text-[13px] leading-snug text-muted-foreground">{detail}</span>
                    </span>
                  </button>
                ))}
              </div>
              {mode !== 'inline' && (
                <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  Show it
                  <Select className={`${INPUT_CLASS} !w-auto`} value={delay} onChange={e => setDelay(Number(e.target.value))} aria-label="When it shows">
                    {[0, 3, 8, 15, 30, 60].map(n => (
                      <option key={n} value={n}>
                        {n ? `${n} seconds after the page opens` : 'as soon as the page opens'}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              <p className="text-sm leading-relaxed text-muted-foreground">
                {mode === 'inline'
                  ? 'Paste both lines where the survey should go. It grows to fit each page of the survey.'
                  : 'Paste it once into your page, anywhere. Closing it or finishing the survey stops it showing to that visitor for 30 days.'}{' '}
                Changes you publish show up without pasting it again.
              </p>
              <CopyBlock primary wrap label="Embed code" value={mode === 'inline' ? surveyEmbedCode(origin, survey.id, survey.name) : surveyPopupCode(origin, survey.id, survey.name, mode, delay)} />
              <p className="text-[13px] leading-relaxed text-muted-foreground">Works on WordPress, Webflow, Squarespace, Wix and plain HTML: use their “Custom HTML” or “Embed” block.</p>
            </>
          )}
          {tab === 'signed' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                For a survey inside your own app: your server asks for a personal link for the signed-in person, and their answers go onto their contact without them typing their
                email. It needs an API key from Settings → Signup forms and API. Someone who isn't a contact yet is only added when the survey's settings name a list.
              </p>
              <CopyBlock label="Server code" value={surveySignedEmbedExample(origin, survey.id)} rows={9} />
            </>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => window.open(open, '_blank', 'noopener')}>
          {survey.status === 'draft' ? 'Preview it' : 'Open the survey'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/** A small drawing of a web page with the survey where each kind of embed puts it. */
function ModeSketch({ mode }: { mode: 'inline' | 'popup' | 'slide' }) {
  const line = 'block h-[3px] rounded-full bg-foreground/15'
  return (
    <span aria-hidden className="relative block h-14 overflow-hidden rounded-[5px] border border-border bg-background p-1.5">
      <span className={`${line} w-2/3`} />
      <span className={`${line} mt-1 w-1/2`} />
      {mode === 'inline' && <span className="mt-1.5 block h-5 w-full rounded-[3px] border border-accent/60 bg-accent/15" />}
      {mode === 'popup' && (
        <>
          <span className={`${line} mt-1 w-3/4`} />
          <span className="absolute inset-0 bg-foreground/15" />
          <span className="absolute left-1/2 top-1/2 h-7 w-12 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-accent/60 bg-card" />
        </>
      )}
      {mode === 'slide' && (
        <>
          <span className={`${line} mt-1 w-3/4`} />
          <span className="absolute bottom-1 right-1 h-6 w-9 rounded-[3px] border border-accent/60 bg-card shadow-sm" />
        </>
      )}
    </span>
  )
}
