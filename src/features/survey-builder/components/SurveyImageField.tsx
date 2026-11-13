import { useId, useRef, useState } from 'react'
import { ImageIcon, Upload, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { hintClass, inputClass, labelClass } from './SurveyBlockEditor'

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp'

/**
 * An image for the survey (logo, background, an image block): a thumbnail of
 * it, Upload, and its address for one already online. Uploads go to the same
 * place as the email builder's (`/api/uploads`).
 */
export function SurveyImageField({ label, value, onChange, hint }: { label: string; value: string; onChange: (url: string) => void; hint?: string }) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const upload = async (file: File) => {
    setError('')
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/uploads', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok || !data.success) setError(data.error || "It couldn't be uploaded.")
      else onChange(data.url)
    } catch {
      setError("It couldn't be uploaded.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-2.5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md-s border border-border bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-[length:12px_12px]">
          {value ? <img src={value} alt="" className="h-full w-full object-contain" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" aria-hidden />}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" isLoading={uploading} leftIcon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>
            {value ? 'Replace' : 'Upload'}
          </Button>
          {value && (
            <Button variant="ghost" size="sm" leftIcon={<X className="h-3.5 w-3.5" />} onClick={() => onChange('')}>
              Remove
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) upload(file)
          }}
        />
      </div>
      <input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder="Or paste its address: https://…" inputMode="url" className={inputClass} />
      {error ? <p className="text-[13px] text-destructive">{error}</p> : hint && <p className={hintClass}>{hint}</p>}
    </div>
  )
}
