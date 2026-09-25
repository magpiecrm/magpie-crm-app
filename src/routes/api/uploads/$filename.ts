import { createFileRoute } from '@tanstack/react-router'
import { readUpload } from '../../../server/uploads'

// Deliberately unauthenticated: this is what an email client fetches when it
// renders a campaign, with no session cookie to send. `readUpload` only
// serves filenames matching its own generated pattern, so this cannot be used
// to read arbitrary files off disk.
export const Route = createFileRoute('/api/uploads/$filename')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { filename: string } }) => {
        const found = readUpload(params.filename)
        if (!found) return new Response('Not found', { status: 404 })

        return new Response(new Uint8Array(found.bytes), {
          headers: {
            'Content-Type': found.mimeType,
            // The filename is a random id that never changes what it points
            // to, so the response can be cached indefinitely.
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        })
      },
    },
  },
})
