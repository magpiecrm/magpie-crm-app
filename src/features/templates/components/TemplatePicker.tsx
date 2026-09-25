import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { getTemplatesFn } from '../../../server/functions'
import { STARTER_TEMPLATES } from '../../email-builder/templates/starters'
import { compileHTML } from '../../email-builder/utils/compiler'
import { DEFAULT_GLOBAL_STYLE } from '../../email-builder/utils/design'

/**
 * A dropdown of saved templates and built-in starters. Picking one hands the
 * compiled HTML to `onPick`; the caller decides whether to confirm first.
 */
export function TemplatePicker({ onPick }: { onPick: (html: string, name: string) => void }) {
  const { data: saved = [] } = useQuery({
    queryKey: queryKeys.templates.list(),
    queryFn: () => getTemplatesFn(),
  })

  const handleChange = (value: string) => {
    if (value.startsWith('saved:')) {
      const template = saved.find(t => t.id === value.slice('saved:'.length))
      if (template) onPick(template.html, template.name)
    } else if (value.startsWith('starter:')) {
      const starter = STARTER_TEMPLATES.find(t => t.id === value.slice('starter:'.length))
      if (starter) {
        onPick(compileHTML(starter.build(), { ...DEFAULT_GLOBAL_STYLE, ...starter.globalStyle }), starter.name)
      }
    }
  }

  return (
    <select
      value=""
      onChange={e => handleChange(e.target.value)}
      className="w-full px-3 py-2 bg-muted/40 border border-border text-foreground rounded-xl text-sm focus:ring-1 focus:ring-accent outline-none cursor-pointer"
    >
      <option value="" disabled>
        Choose a template…
      </option>
      {saved.length > 0 && (
        <optgroup label="Your templates">
          {saved.map(t => (
            <option key={t.id} value={`saved:${t.id}`}>
              {t.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Starter layouts">
        {STARTER_TEMPLATES.map(t => (
          <option key={t.id} value={`starter:${t.id}`}>
            {t.name} ({t.category})
          </option>
        ))}
      </optgroup>
    </select>
  )
}
