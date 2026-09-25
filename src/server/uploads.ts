// Storage for images uploaded from the email builder.
//
// Files live in an `uploads/` directory next to the JSON "database" file, so
// in production they land on the same Railway volume as `local_db.json`
// automatically — anything written under the app's own directory instead
// would be wiped on the next deploy.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import crypto from 'crypto'
import { env } from './env'

const MAX_BYTES = 5 * 1024 * 1024

// Extension is derived from a magic-byte sniff of the actual file content,
// never from the browser-supplied Content-Type or filename — those are
// attacker-controlled. This also fixes the extension used when the file is
// served back, so a mislabeled upload can't get an inconsistent Content-Type.
const SIGNATURES: Array<{ mimeType: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mimeType: 'image/jpeg', ext: '.jpg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mimeType: 'image/png',
    ext: '.png',
    test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/gif',
    ext: '.gif',
    test: (b) => b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a'),
  },
  {
    mimeType: 'image/webp',
    ext: '.webp',
    test: (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
]

// SVG is deliberately not supported: it can carry <script>/event-handler
// content, and the builder would render an uploaded one directly in its own
// preview — a stored-XSS path we'd rather not open for an image field.

export interface SavedUpload {
  filename: string
  mimeType: string
  size: number
}

export function getUploadsDir(): string {
  const dbPath = env.databasePath() || join(process.cwd(), 'local_db.json')
  const dir = join(dirname(dbPath), 'uploads')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function saveUpload(bytes: Buffer): SavedUpload {
  if (bytes.byteLength === 0) {
    throw new Error('File is empty.')
  }
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`Image is too large (max ${MAX_BYTES / (1024 * 1024)}MB).`)
  }

  const signature = SIGNATURES.find((s) => s.test(bytes))
  if (!signature) {
    throw new Error('Unsupported image type. Use JPEG, PNG, GIF, or WebP.')
  }

  const filename = `${crypto.randomUUID()}${signature.ext}`
  writeFileSync(join(getUploadsDir(), filename), bytes)

  return { filename, mimeType: signature.mimeType, size: bytes.byteLength }
}

// Only filenames matching exactly what saveUpload generates are servable,
// which rules out path traversal without needing to sanitize a free-form path.
const FILENAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/

export function readUpload(filename: string): { bytes: Buffer; mimeType: string } | null {
  if (!FILENAME_PATTERN.test(filename)) return null

  const path = join(getUploadsDir(), filename)
  if (!existsSync(path)) return null

  const ext = filename.slice(filename.lastIndexOf('.'))
  const mimeType = SIGNATURES.find((s) => s.ext === ext)?.mimeType || 'application/octet-stream'
  return { bytes: readFileSync(path), mimeType }
}
