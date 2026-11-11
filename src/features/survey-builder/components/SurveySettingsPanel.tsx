import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { listsFn } from '../../../server/functions'
import type { SurveySettings } from '../types'
import type { LintIssue } from '../logic/lint'
import { Toggle, hintClass, inputClass, labelClass, sectionLabelClass } from './SurveyBlockEditor'
import { Select } from '../../../components/ui/Select'

interface SurveySettingsPanelProps {
  settings: SurveySettings
  setSettings: (updates: Partial<SurveySettings>) => void
  /** Checks that belong here (an Email question missing while contacts are identified). */
  issues: LintIssue[]
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function SurveySettingsPanel({ settings, setSettings, issues }: SurveySettingsPanelProps) {
  const { data: listsData } = useQuery({ queryKey: queryKeys.email.lists(), queryFn: () => listsFn() })
  const lists = (listsData?.lists ?? []) as Array<{ id: number; name: string }>

  return (
    <div className="flex-1 space-y-7 overflow-y-auto p-5 custom-scrollbar">
      <section className="space-y-4">
        <h3 className={sectionLabelClass}>Contacts</h3>
        <Toggle
          label="Identify contacts"
          hint="Match people who answer from the public link or an embed to their contact, by their answer to an Email question. People from a campaign are always matched."
          checked={settings.identifyContacts}
          onChange={identifyContacts => setSettings({ identifyContacts })}
        />
        {issues.map((issue, i) => (
          <p key={i} className="flex items-start gap-2 rounded-md-s border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2.5 text-[13px] leading-relaxed text-foreground dark:bg-amber-500/10">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            {issue.message}
          </p>
        ))}
        {settings.identifyContacts && (
          <div className="space-y-1.5">
            <label className={labelClass} htmlFor="survey-new-contacts">
              New people
            </label>
            <Select
              id="survey-new-contacts"
              value={settings.listId ?? ''}
              onChange={e => setSettings({ listId: e.target.value ? Number(e.target.value) : null })}
              className={inputClass}
            >
              <option value="">Don't add them as contacts</option>
              {lists.map(l => (
                <option key={l.id} value={l.id}>
                  Add them to {l.name}
                </option>
              ))}
            </Select>
            <p className={hintClass}>{settings.listId ? 'Someone who isn’t a contact yet becomes a subscribed contact on that list, as with a form.' : 'Only people who are already contacts get their answers saved.'}</p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h3 className={sectionLabelClass}>Responses</h3>
        <Toggle label="More than one response each" hint="Let the same contact answer it more than once." checked={settings.allowMultipleResponses} onChange={allowMultipleResponses => setSettings({ allowMultipleResponses })} />
        <Toggle label="Back button" hint="Let people go back a page to change an answer." checked={settings.allowBack} onChange={allowBack => setSettings({ allowBack })} />
        <Toggle label="Tell me about new responses" hint="A notification in the app for each one." checked={settings.notifyOnResponse} onChange={notifyOnResponse => setSettings({ notifyOnResponse })} />
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="survey-closes-at">
            Close it automatically
          </label>
          <input
            id="survey-closes-at"
            type="datetime-local"
            lang="en-GB"
            value={settings.closesAt ? toLocalInput(settings.closesAt) : ''}
            onChange={e => setSettings({ closesAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className={inputClass}
          />
          <p className={hintClass}>{settings.closesAt ? `It stops taking responses on ${dateFmt.format(new Date(settings.closesAt))}.` : 'Leave it empty to keep it open until you close it.'}</p>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className={sectionLabelClass}>When they finish</h3>
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="survey-thanks-title">
            Heading
          </label>
          <input id="survey-thanks-title" value={settings.thankYou.title} onChange={e => setSettings({ thankYou: { ...settings.thankYou, title: e.target.value } })} className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="survey-thanks-message">
            Message
          </label>
          <textarea id="survey-thanks-message" rows={3} value={settings.thankYou.message} onChange={e => setSettings({ thankYou: { ...settings.thankYou, message: e.target.value } })} className={inputClass} />
        </div>
        <div className="space-y-1.5">
          <label className={labelClass} htmlFor="survey-thanks-redirect">
            Then go to a page <span className="font-normal text-muted-foreground">Optional</span>
          </label>
          <input
            id="survey-thanks-redirect"
            value={settings.thankYou.redirectUrl ?? ''}
            placeholder="https://"
            inputMode="url"
            onChange={e => setSettings({ thankYou: { ...settings.thankYou, redirectUrl: e.target.value || undefined } })}
            className={inputClass}
          />
          <p className={hintClass}>They see the message for a moment first.</p>
        </div>
      </section>
    </div>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
