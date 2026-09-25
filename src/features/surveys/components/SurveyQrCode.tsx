import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Download } from 'lucide-react'

/** The public link, tagged so scans are counted as their own source in results. */
export const surveyQrUrl = (origin: string, surveyId: string) => `${origin}/s/${surveyId}?src=qr`

/**
 * Black on white with a quiet zone and medium error correction: the
 * combination every phone camera reads reliably, including from print.
 */
const QR_OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 2, color: { dark: '#000000', light: '#ffffff' } }

function download(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.click()
}

export function SurveyQrCode({ url, name }: { url: string; name: string }) {
  const [preview, setPreview] = useState('')
  const filename = `${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'survey'}-qr`

  useEffect(() => {
    QRCode.toDataURL(url, { ...QR_OPTIONS, width: 240 }).then(setPreview, () => setPreview(''))
  }, [url])

  const downloadPng = async () => download(await QRCode.toDataURL(url, { ...QR_OPTIONS, width: 1024 }), `${filename}.png`)
  const downloadSvg = async () => {
    const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' })
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    download(blobUrl, `${filename}.svg`)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }

  const buttonClass =
    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md-s border border-border hover:bg-muted cursor-pointer'

  return (
    <div className="flex flex-col sm:flex-row gap-5 items-start">
      <div className="w-40 h-40 shrink-0 bg-white rounded-md-s border border-border flex items-center justify-center">
        {preview ? <img src={preview} alt={`QR code for ${name}`} className="w-full h-full" /> : null}
      </div>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Print it on posters, packaging, receipts or slides. Scans open the public survey and show as "QR code" in results.
          Use the SVG for print — it stays sharp at any size.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={downloadPng} className={buttonClass}>
            <Download className="w-3.5 h-3.5" /> PNG
          </button>
          <button type="button" onClick={downloadSvg} className={buttonClass}>
            <Download className="w-3.5 h-3.5" /> SVG
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground font-mono break-all">{url}</p>
      </div>
    </div>
  )
}
