import { useId, useState, type CSSProperties } from 'react'
import { HONEYPOT, type FormValue, type PublicForm, type ResolvedFormField } from '../model'
import { FORM_CSS, formCssVars, layoutRows } from '../render'

export type FormSubmitResult = { ok: true; message?: string } | { ok: false; error?: string; problems?: Record<string, string> }

/**
 * A form as the people filling it in see it: the hosted page, the iframe embed
 * and the builder's preview all draw it with this, in the same CSS as the plain
 * HTML snippet (render.ts). `onSubmit` is left out in a preview, which checks
 * the required fields and then shows the thank-you without sending anything.
 */
export function FormView({
  form,
  onSubmit,
  preview = false,
  done: initialDone = false,
  onReset,
  activeKey,
  onFieldPick,
  headingLevel = 2,
}: {
  form: PublicForm
  onSubmit?: (values: Record<string, FormValue>) => Promise<FormSubmitResult>
  preview?: boolean
  done?: boolean
  onReset?: () => void
  /** In the builder: the field being edited, outlined. */
  activeKey?: string | null
  /** In the builder: a field was clicked, to edit it. */
  onFieldPick?: (key: string) => void
  /** 1 on the form's own page, where the heading is the page's. */
  headingLevel?: 1 | 2
}) {
  const uid = useId().replace(/:/g, '')
  const [values, setValues] = useState<Record<string, FormValue>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<string | null>(initialDone ? form.successMessage : null)

  const set = (key: string, v: FormValue) => {
    setValues((s) => ({ ...s, [key]: v }))
    if (problems[key]) setProblems(({ [key]: _gone, ...rest }) => rest)
  }

  // The browser's own required check would stop a preview before it shows anything, so fields are checked here.
  const check = () => {
    const out: Record<string, string> = {}
    for (const f of form.fields) {
      const v = values[f.key]
      const empty = v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)
      if (f.required && empty) out[f.key] = f.type === 'checkbox' ? 'Tick this to continue.' : f.type === 'select' || f.type === 'multiselect' ? 'Choose an option.' : `Enter your ${f.label.toLowerCase()}.`
      else if (f.type === 'email' && !empty && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) out[f.key] = 'Enter an email address like name@company.com.'
    }
    return out
  }

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    const found = check()
    setProblems(found)
    if (Object.keys(found).length) {
      document.getElementById(`${uid}-${Object.keys(found)[0].replace(/[^a-z0-9_-]/gi, '_')}`)?.focus()
      return
    }
    if (!onSubmit) {
      setDone(form.successMessage)
      return
    }
    setSending(true)
    const hp = (e.currentTarget.elements.namedItem(HONEYPOT) as HTMLInputElement | null)?.value
    const result: FormSubmitResult = await onSubmit({ ...values, ...(hp ? { [HONEYPOT]: hp } : {}) }).catch((): FormSubmitResult => ({ ok: false }))
    setSending(false)
    if (result.ok) setDone(result.message || form.successMessage)
    else {
      setProblems(result.problems ?? {})
      setError(result.problems && Object.keys(result.problems).length ? '' : result.error || 'Something went wrong. Please try again.')
    }
  }

  const style = formCssVars(form.style) as CSSProperties
  const pick = onFieldPick ? { activeKey, onPick: onFieldPick } : undefined
  const dark = form.style.theme === 'dark' ? ' mf-dark' : ''

  return (
    <div className="mf-wrap">
      <style>{FORM_CSS}</style>
      {pick && <style>{PICK_CSS}</style>}
      {done !== null ? (
        <div className={`mf${dark}`} style={style} role="status">
          <div className="mf-done">
            <span className="mf-done-mark" aria-hidden="true">✓</span>
            <p>{done}</p>
          </div>
          {preview && onReset && (
            <button type="button" onClick={() => { setDone(null); setValues({}); onReset() }} className="mf-preview-reset">
              Show the form again
            </button>
          )}
        </div>
      ) : (
        <form className={`mf${dark}`} style={style} onSubmit={submit} noValidate aria-label={form.heading || form.name}>
          {(form.heading || form.intro) && (
            <div
              className={`mf-head${pick ? ' mf-pick' : ''}`}
              {...(pick ? { onPointerDown: () => pick.onPick(HEADING_PICK), 'data-pick': HEADING_PICK } : {})}
            >
              {form.heading && (headingLevel === 1 ? <h1 className="mf-title">{form.heading}</h1> : <h2 className="mf-title">{form.heading}</h2>)}
              {form.intro && <p className="mf-intro">{form.intro}</p>}
            </div>
          )}
          {layoutRows(form.fields).map((row) =>
            row.length > 1 ? (
              <div key={row[0].key} className="mf-row">
                {row.map((f) => <Field key={f.key} f={f} uid={uid} value={values[f.key]} problem={problems[f.key]} onChange={(v) => set(f.key, v)} pick={pick} />)}
              </div>
            ) : (
              <Field key={row[0].key} f={row[0]} uid={uid} value={values[row[0].key]} problem={problems[row[0].key]} onChange={(v) => set(row[0].key, v)} pick={pick} />
            ),
          )}
          <div className="mf-hp" aria-hidden="true">
            <input name={HONEYPOT} tabIndex={-1} autoComplete="off" />
          </div>
          {error && <p className="mf-error" role="alert">{error}</p>}
          <button className="mf-button" type="submit" disabled={sending || form.paused}>
            {sending ? 'Sending…' : form.submitLabel}
          </button>
          {form.privacyUrl && (
            <p className="mf-privacy">
              How we use your details: <a href={form.privacyUrl} target="_blank" rel="noopener noreferrer">privacy policy</a>
            </p>
          )}
        </form>
      )}
    </div>
  )
}

/** What `onFieldPick` is given when the heading or intro is clicked. */
export const HEADING_PICK = '__heading'

/** The builder's preview: a field shows it can be clicked, and the one being edited is outlined. */
const PICK_CSS = `.mf-pick{cursor:pointer;border-radius:10px;outline:2px solid transparent;outline-offset:5px;transition:outline-color .12s}
.mf-pick:hover{outline:1px dashed #8f949d}
.mf-picked,.mf-picked:hover{outline:2px solid var(--accent,#0d7285)}`

type Pick = { activeKey?: string | null; onPick: (key: string) => void }

function Field({ f, uid, value, problem, onChange, pick }: { f: ResolvedFormField; uid: string; value: FormValue | undefined; problem?: string; onChange: (v: FormValue) => void; pick?: Pick }) {
  const picking = pick
    ? { onPointerDown: () => pick.onPick(f.key), onFocusCapture: () => pick.onPick(f.key), 'data-pick': f.key }
    : {}
  const pickCls = pick ? ` mf-pick${pick.activeKey === f.key ? ' mf-picked' : ''}` : ''
  const id = `${uid}-${f.key.replace(/[^a-z0-9_-]/gi, '_')}`
  const errId = `${id}-error`
  const optional = f.required ? null : <span className="mf-optional">Optional</span>
  const helpId = `${id}-help`
  const describedBy = [f.help ? helpId : '', problem ? errId : ''].filter(Boolean).join(' ') || undefined
  const aria = { 'aria-invalid': problem ? true : undefined, 'aria-describedby': describedBy, 'aria-required': f.required || undefined }
  const help = f.help ? <p className="mf-help" id={helpId}>{f.help}</p> : null
  const err = problem ? <p className="mf-error" id={errId}>{problem}</p> : null
  const cls = `mf-input${problem ? ' mf-invalid' : ''}`

  if (f.type === 'checkbox') {
    return (
      <div className={`mf-field${pickCls}`} {...picking}>
        <label className="mf-check">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} {...aria} />
          <span>{f.label}{optional}</span>
        </label>
        {err}
      </div>
    )
  }
  if (f.type === 'multiselect') {
    const picked = Array.isArray(value) ? value : []
    return (
      <fieldset className={`mf-field${pickCls}`} aria-describedby={problem ? errId : undefined} {...picking}>
        <legend className="mf-label">{f.label}{optional}</legend>
        {help}
        <div className="mf-choices">
          {(f.options ?? []).map((o, i) => (
            <label key={o} className="mf-check">
              <input id={i === 0 ? id : undefined} type="checkbox" checked={picked.includes(o)} onChange={(e) => onChange(e.target.checked ? [...picked, o] : picked.filter((p) => p !== o))} />
              <span>{o}</span>
            </label>
          ))}
        </div>
        {err}
      </fieldset>
    )
  }
  const text = typeof value === 'string' ? value : ''
  let control
  if (f.type === 'textarea') control = <textarea id={id} className={cls} rows={4} value={text} placeholder={f.placeholder || undefined} onChange={(e) => onChange(e.target.value)} {...aria} />
  else if (f.type === 'select') {
    control = (
      <select id={id} className={cls} value={text} onChange={(e) => onChange(e.target.value)} {...aria}>
        <option value="">Choose…</option>
        {(f.options ?? []).map((o) => <option key={o}>{o}</option>)}
      </select>
    )
  } else {
    const type = f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'
    const auto = ({ email: 'email', first_name: 'given-name', last_name: 'family-name', company: 'organization', job_title: 'organization-title' } as Record<string, string>)[f.key]
    control = <input id={id} className={cls} type={type} value={text} autoComplete={auto} placeholder={f.placeholder || undefined} onChange={(e) => onChange(e.target.value)} {...aria} />
  }
  return (
    <div className={`mf-field${pickCls}`} {...picking}>
      <label className="mf-label" htmlFor={id}>{f.label}{optional}</label>
      {help}
      {control}
      {err}
    </div>
  )
}
