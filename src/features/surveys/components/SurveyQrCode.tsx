import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Download } from 'lucide-react'
import { Button } from '../../../components/ui/Button'

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

  return (
    <div className="flex flex-col items-start gap-4 sm:flex-row sm:gap-5">
      <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-md-s border border-border bg-white">
        {preview ? <img src={preview} alt={`QR code for ${name}`} className="h-full w-full" /> : null}
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          For posters, packaging, receipts or slides. Scans open the survey and show up as “QR code” in its results. The SVG stays sharp at any size, so use it for print.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={downloadSvg}>
            SVG
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={downloadPng}>
            PNG
          </Button>
        </div>
      </div>
    </div>
  )
}
