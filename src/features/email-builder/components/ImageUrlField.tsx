import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp'

interface ImageUrlFieldProps {
  label?: string
  value: string
  onChange: (url: string) => void
  placeholder?: string
  /** Tighter spacing/type scale, for the inline item-list and section-child rows. */
  compact?: boolean
  /** Live `<img>` preview below the field — used by the main Image block. */
  showPreview?: boolean
}

/**
 * A URL text field with an upload button next to it — either path ends up
 * calling `onChange` with a URL, so nothing downstream (the compiler, the
 * preview) needs to know which one the user picked.
 */
export function ImageUrlField({
  label,
  value,
  onChange,
  placeholder,
  compact = false,
  showPreview = false,
}: ImageUrlFieldProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState('')

  const inputClass = compact
    ? 'flex-1 min-w-0 px-2 py-1 bg-muted border border-border rounded text-[11px] font-mono text-foreground focus:outline-none'
    : 'flex-1 min-w-0 px-3 py-2 bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-accent text-xs'

  const buttonClass = compact
    ? 'shrink-0 p-1 text-muted-foreground hover:text-foreground hover:bg-muted border border-border rounded transition-colors cursor-pointer disabled:opacity-50'
    : 'shrink-0 px-2.5 py-2 text-muted-foreground hover:text-foreground hover:bg-muted border border-border rounded-lg transition-colors cursor-pointer disabled:opacity-50'

  const handleFile = async (file: File) => {
    setError('')
    setIsUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/uploads', { method: 'POST', body })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setError(data.error || 'Upload failed')
        return
      }
      onChange(data.url)
    } catch {
      setError('Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {label && <label className="block text-xs text-muted-foreground font-semibold">{label}</label>}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={value}
          placeholder={placeholder || 'Image URL'}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) handleFile(file)
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className={buttonClass}
          title="Upload an image"
        >
          {isUploading ? (
            <Loader2 className={compact ? 'w-3 h-3 animate-spin' : 'w-4 h-4 animate-spin'} />
          ) : (
            <Upload className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
          )}
        </button>
      </div>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
      {showPreview && value && (
        <div className="border border-border/50 rounded-lg overflow-hidden bg-muted p-1">
          <img src={value} alt="Preview" className="max-h-32 mx-auto rounded object-cover" style={{ maxWidth: '100%' }} />
        </div>
      )}
    </div>
  )
}
