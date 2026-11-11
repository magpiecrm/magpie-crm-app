import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Code2, ExternalLink, KeyRound, Link2, Mail } from 'lucide-react'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { Notice } from '../../../components/ui/Notice'
import { CopyBlock } from '../../../components/ui/CopyBlock'
import type { SurveyStatus } from '../../survey-builder/types'
import { surveyEmbedSnippet, surveySignedEmbedExample } from '../embed'
import { SurveyQrCode, surveyQrUrl } from './SurveyQrCode'

type Tab = 'link' | 'email' | 'embed' | 'signed'

const TABS: Array<{ id: Tab; label: string; short: string; icon: typeof Code2 }> = [
  { id: 'link', label: 'Link and QR', short: 'Link', icon: Link2 },
  { id: 'email', label: 'Email', short: 'Email', icon: Mail },
  { id: 'embed', label: 'Embed', short: 'Embed', icon: Code2 },
  { id: 'signed', label: 'Your app', short: 'App', icon: KeyRound },
]

/**
 * Every way to put a survey in front of people: its link (and a QR code of
 * it), an email campaign, an embed on a website, and a personal link from
 * your own app's server for signed-in users.
 */
export function SurveyShareDialog({ survey, onClose }: { survey: { id: string; name: string; status: SurveyStatus }; onClose: () => void }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('link')
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const link = `${origin}/s/${survey.id}`
  const open = `${link}${survey.status === 'draft' ? '?preview=1' : ''}`

  return (
    <Dialog isOpen onClose={onClose} title={`Share “${survey.name}”`} description="Send it by email, share its link, or put it on your website." className="sm:max-w-2xl">
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

        <div role="tabpanel" id={`survey-share-panel-${tab}`} aria-labelledby={`survey-share-tab-${tab}`} className="flex flex-col gap-4">
          {tab === 'link' && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Anyone with the link can answer. Answers are anonymous, unless the survey asks for an email and “Identify contacts” is on in its settings.
              </p>
              <CopyBlock primary wrap label="Link" value={link} />
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
              <p className="text-sm leading-relaxed text-muted-foreground">
                Paste it into your page where the survey should go. It grows to fit each page of the survey, and changes you publish show up without pasting it again.
              </p>
              <CopyBlock primary label="Embed code" value={surveyEmbedSnippet(origin, survey.id)} rows={8} />
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
