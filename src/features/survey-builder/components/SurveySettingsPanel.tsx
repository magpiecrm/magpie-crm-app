import { useState } from 'react'
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
        <CloseDateField value={settings.closesAt ?? null} onChange={closesAt => setSettings({ closesAt })} />
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

const pad = (n: number) => String(n).padStart(2, '0')
const dayInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TIMES = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`)

/** End of a day `days` from now, 23:30 local, the way people mean "in a week". */
function inDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(23, 30, 0, 0)
  return d.toISOString()
}

function endOfMonth(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 0)
  d.setHours(23, 30, 0, 0)
  return d.toISOString()
}

/**
 * When the survey stops taking responses: a few common choices, or a day and
 * a time of your own; always said back in words, day first.
 */
function CloseDateField({ value, onChange }: { value: string | null; onChange: (iso: string | null) => void }) {
  const [custom, setCustom] = useState(!!value)
  const date = value ? new Date(value) : null
  return (
    <div className="space-y-1.5">
      <label className={labelClass} htmlFor="survey-closes">
        Close it automatically
      </label>
      <Select
        id="survey-closes"
        value={custom || value ? 'date' : 'never'}
        onChange={e => {
          const v = e.target.value
          if (v === 'never') (setCustom(false), onChange(null))
          else if (v === 'date') (setCustom(true), onChange(value ?? inDays(14)))
          else (setCustom(true), onChange(v === 'month' ? endOfMonth() : inDays(Number(v))))
        }}
        className={inputClass}
      >
        <option value="never">Never: I'll close it myself</option>
        <option value="7">In a week</option>
        <option value="14">In two weeks</option>
        <option value="30">In 30 days</option>
        <option value="month">At the end of this month</option>
        <option value="date">On a date…</option>
      </Select>
      {date && (
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
          <input
            type="date"
            aria-label="Day it closes"
            value={dayInput(date)}
            onChange={e => {
              if (!e.target.value) return
              const [y, m, d] = e.target.value.split('-').map(Number)
              const next = new Date(date)
              next.setFullYear(y, m - 1, d)
              onChange(next.toISOString())
            }}
            className={inputClass}
          />
          <Select
            aria-label="Time it closes"
            value={`${pad(date.getHours())}:${date.getMinutes() < 30 ? '00' : '30'}`}
            onChange={e => {
              const [h, min] = e.target.value.split(':').map(Number)
              const next = new Date(date)
              next.setHours(h, min, 0, 0)
              onChange(next.toISOString())
            }}
            className={inputClass}
          >
            {TIMES.map(t => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      )}
      <p className={hintClass}>{date ? `It stops taking responses on ${dateFmt.format(date)}.` : 'It stays open until you close it.'}</p>
    </div>
  )
}
