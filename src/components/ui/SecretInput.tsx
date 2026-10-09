import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { INPUT_CLASS } from './Field'

/** A key or password field that's hidden by default, with a show/hide toggle. */
export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative flex items-center">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        // Browsers ignore autocomplete="off" on password fields; "new-password"
        // plus the password-manager opt-outs keeps saved logins and stray form
        // history from being filled in as an API key.
        autoComplete="new-password"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${INPUT_CLASS} pr-10 font-mono`}
      />
      <button
        type="button"
        aria-label={visible ? 'Hide' : 'Show'}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}
