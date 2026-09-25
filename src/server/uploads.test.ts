import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { vi } from 'vitest'

// Point env.databasePath() at a scratch directory so uploads land somewhere
// disposable, and so this suite proves the "sibling of the DB" placement
// works without touching the real local_db.json.
let scratchDir: string

vi.mock('./env', () => ({
  env: { databasePath: () => join(scratchDir, 'local_db.json') },
}))

const { saveUpload, readUpload, getUploadsDir } = await import('./uploads')

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngBytes = (padTo = 100) => Buffer.concat([PNG_HEADER, Buffer.alloc(padTo)])
const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(50)])
const gifBytes = () => Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(50)])
const webpBytes = () =>
  Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii'), Buffer.alloc(50)])

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'uploads-test-'))
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('saveUpload', () => {
  it('accepts a real PNG and stores it next to the database file', () => {
    const saved = saveUpload(pngBytes())
    expect(saved.filename).toMatch(/^[0-9a-f-]{36}\.png$/)
    expect(saved.mimeType).toBe('image/png')

    const uploadsDir = getUploadsDir()
    expect(uploadsDir).toBe(join(scratchDir, 'uploads'))
    expect(existsSync(join(uploadsDir, saved.filename))).toBe(true)
  })

  it('accepts JPEG, GIF, and WebP by content, not by any supplied name', () => {
    expect(saveUpload(jpegBytes()).filename).toMatch(/\.jpg$/)
    expect(saveUpload(gifBytes()).filename).toMatch(/\.gif$/)
    expect(saveUpload(webpBytes()).filename).toMatch(/\.webp$/)
  })

  it('rejects a file whose bytes are not a recognized image format', () => {
    // An HTML file renamed to look like an image is still just bytes here —
    // saveUpload never trusts a filename or declared Content-Type.
    const html = Buffer.from('<html><script>alert(1)</script></html>')
    expect(() => saveUpload(html)).toThrow(/Unsupported image type/)
  })

  it('rejects SVG even though it is a real, well-formed image', () => {
    // Deliberately unsupported: SVG can carry <script>, and the builder
    // renders uploaded images directly in its own preview.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(() => saveUpload(svg)).toThrow(/Unsupported image type/)
  })

  it('rejects an empty file', () => {
    expect(() => saveUpload(Buffer.alloc(0))).toThrow(/empty/)
  })

  it('rejects a file over the size limit', () => {
    const tooBig = pngBytes(6 * 1024 * 1024)
    expect(() => saveUpload(tooBig)).toThrow(/too large/)
  })

  it('generates a fresh random filename per call, even for identical bytes', () => {
    const bytes = pngBytes()
    const a = saveUpload(bytes)
    const b = saveUpload(bytes)
    expect(a.filename).not.toBe(b.filename)
    expect(readdirSync(getUploadsDir())).toHaveLength(2)
  })
})

describe('readUpload', () => {
  it('serves back exactly what was saved, with the sniffed mime type', () => {
    const bytes = pngBytes()
    const saved = saveUpload(bytes)
    const found = readUpload(saved.filename)
    expect(found).not.toBeNull()
    expect(found!.mimeType).toBe('image/png')
    expect(found!.bytes.equals(bytes)).toBe(true)
  })

  it('returns null for a filename that does not exist', () => {
    expect(readUpload('11111111-1111-4111-8111-111111111111.png')).toBeNull()
  })

  it('refuses path traversal attempts outright, before touching the filesystem', () => {
    expect(readUpload('../local_db.json')).toBeNull()
    expect(readUpload('..%2f..%2flocal_db.json')).toBeNull()
    expect(readUpload('/etc/passwd')).toBeNull()
    expect(readUpload('a/../../../etc/passwd')).toBeNull()
  })

  it('refuses filenames with a disallowed extension even if otherwise UUID-shaped', () => {
    expect(readUpload('11111111-1111-4111-8111-111111111111.exe')).toBeNull()
    expect(readUpload('11111111-1111-4111-8111-111111111111.svg')).toBeNull()
    expect(readUpload('11111111-1111-4111-8111-111111111111')).toBeNull()
  })
})
