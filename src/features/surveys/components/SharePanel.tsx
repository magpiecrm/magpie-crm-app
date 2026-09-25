import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import type { SurveyStatus } from '../../survey-builder/types'
import { surveyEmbedSnippet, surveySignedEmbedExample } from '../embed'
import { SurveyQrCode, surveyQrUrl } from './SurveyQrCode'

function CopyBox({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="flex items-center gap-1 text-xs text-accent hover:underline cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {multiline ? (
        <pre className="text-xs bg-muted border border-border rounded-md-s p-3 overflow-x-auto whitespace-pre-wrap break-all">{value}</pre>
      ) : (
        <input readOnly value={value} onFocus={e => e.target.select()} className="w-full text-xs bg-muted border border-border rounded-md-s px-3 py-2 font-mono" />
      )}
    </div>
  )
}

export function SharePanel({ surveyId, status, name }: { surveyId: string; status: SurveyStatus; name: string }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const link = `${origin}/s/${surveyId}`

  return (
    <div className="space-y-6 max-w-3xl">
      {status !== 'published' && (
        <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md-s p-3">
          {status === 'draft' ? 'Publish the survey before sharing it — draft links show "not found".' : 'This survey is closed and no longer accepts responses.'}
        </p>
      )}

      <div className="card border border-border rounded-md-m p-5 space-y-3">
        <h3 className="font-medium text-foreground">Public link</h3>
        <p className="text-xs text-muted-foreground">
          Anyone with this link can respond. Responses are anonymous unless the survey has an Email question and "Identify contacts" is on.
        </p>
        <CopyBox label="Link" value={link} />
        <a href={`${link}${status === 'draft' ? '?preview=1' : ''}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
          <ExternalLink className="w-3.5 h-3.5" /> Open {status === 'draft' ? 'preview' : 'survey'}
        </a>
      </div>

      <div className="card border border-border rounded-md-m p-5 space-y-3">
        <h3 className="font-medium text-foreground">QR code</h3>
        <SurveyQrCode url={surveyQrUrl(origin, surveyId)} name={name} />
      </div>

      <div className="card border border-border rounded-md-m p-5 space-y-3">
        <h3 className="font-medium text-foreground">Embed on a website</h3>
        <p className="text-xs text-muted-foreground">Paste this where the survey should appear. It resizes itself to fit.</p>
        <CopyBox label="Embed code" value={surveyEmbedSnippet(origin, surveyId)} multiline />
      </div>

      <div className="card border border-border rounded-md-m p-5 space-y-3">
        <h3 className="font-medium text-foreground">Embed for signed-in users</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          If the survey sits inside your own app, your server can ask for a personal link for the signed-in user. Their answers go
          straight to their contact profile, and they never see or fill in the Email question. Create an API key under Settings →
          Public API. If the email isn't a contact yet, one is only created when the survey has a list set (Settings in the builder).
        </p>
        <CopyBox label="Server code" value={surveySignedEmbedExample(origin, surveyId)} multiline />
      </div>

      <div className="card border border-border rounded-md-m p-5 space-y-2">
        <h3 className="font-medium text-foreground">Send by email</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          In the email builder, add a <strong>Survey</strong> block and pick this survey. Each recipient gets a personal link, so their
          answers go straight onto their contact profile. Choose "Answer in email" to put the first rating, NPS, yes/no or choice
          question right in the email.
        </p>
      </div>
    </div>
  )
}
