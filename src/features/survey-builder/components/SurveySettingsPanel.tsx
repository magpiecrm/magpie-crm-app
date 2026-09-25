import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { listsFn } from '../../../server/functions'
import type { SurveySettings } from '../types'
import { Toggle, inputClass, labelClass, sectionLabelClass } from './SurveyBlockEditor'

interface SurveySettingsPanelProps {
  settings: SurveySettings
  setSettings: (updates: Partial<SurveySettings>) => void
}

export function SurveySettingsPanel({ settings, setSettings }: SurveySettingsPanelProps) {
  const { data: listsData } = useQuery({ queryKey: queryKeys.email.lists(), queryFn: () => listsFn() })
  const lists = (listsData?.lists ?? []) as Array<{ id: number; name: string }>

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
      <div className="space-y-3">
        <span className={sectionLabelClass}>Contacts</span>
        <Toggle
          label="Identify contacts from the Email question"
          checked={settings.identifyContacts}
          onChange={identifyContacts => setSettings({ identifyContacts })}
        />
        <p className="text-[10px] text-muted-foreground leading-snug">
          Respondents from an email campaign are always linked to their contact. For the public link and embeds, this uses the
          answer to an Email question instead.
        </p>
        {settings.identifyContacts && (
          <div className="space-y-1">
            <label className={labelClass}>Add new respondents to list</label>
            <select
              value={settings.listId ?? ''}
              onChange={e => setSettings({ listId: e.target.value ? Number(e.target.value) : null })}
              className={inputClass}
            >
              <option value="">Don't create new contacts</option>
              {lists.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground leading-snug">
              With a list, unknown respondents become subscribed contacts on it (like Forms). Without one, only existing contacts are
              updated.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <span className={sectionLabelClass}>Responses</span>
        <Toggle
          label="Allow more than one response per contact"
          checked={settings.allowMultipleResponses}
          onChange={allowMultipleResponses => setSettings({ allowMultipleResponses })}
        />
        <Toggle label="Show a Back button" checked={settings.allowBack} onChange={allowBack => setSettings({ allowBack })} />
        <Toggle label="Notify me of new responses" checked={settings.notifyOnResponse} onChange={notifyOnResponse => setSettings({ notifyOnResponse })} />
        <div className="space-y-1">
          <label className={labelClass}>Close automatically on</label>
          <input
            type="datetime-local"
            value={settings.closesAt ? toLocalInput(settings.closesAt) : ''}
            onChange={e => setSettings({ closesAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className={inputClass}
          />
        </div>
      </div>

      <div className="space-y-3">
        <span className={sectionLabelClass}>Thank-you screen</span>
        <div className="space-y-1">
          <label className={labelClass}>Title</label>
          <input
            value={settings.thankYou.title}
            onChange={e => setSettings({ thankYou: { ...settings.thankYou, title: e.target.value } })}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Message</label>
          <textarea
            rows={3}
            value={settings.thankYou.message}
            onChange={e => setSettings({ thankYou: { ...settings.thankYou, message: e.target.value } })}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Redirect to (optional)</label>
          <input
            value={settings.thankYou.redirectUrl ?? ''}
            placeholder="https://"
            onChange={e => setSettings({ thankYou: { ...settings.thankYou, redirectUrl: e.target.value || undefined } })}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
