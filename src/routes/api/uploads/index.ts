import { createFileRoute } from '@tanstack/react-router'

// Accepts an image from the email builder and returns an absolute URL for it.
// Absolute, not relative: the compiler only rewrites <a href> to be absolute
// (see normalizeHref), never <img src>, so a relative URL here would render
// fine in the builder's own preview but break the moment a campaign is sent.
export const Route = createFileRoute('/api/uploads/')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { requireAuth } = await import('../../../server/auth.server')
        try {
          await requireAuth()
        } catch {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let form: FormData
        try {
          form = await request.formData()
        } catch {
          return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
        }

        const file = form.get('file')
        if (!(file instanceof File)) {
          return Response.json({ error: 'No file provided' }, { status: 400 })
        }

        const { saveUpload } = await import('../../../server/uploads')
        try {
          const bytes = Buffer.from(await file.arrayBuffer())
          const saved = saveUpload(bytes)

          const { getAppUrl } = await import('../../../server/appUrl')
          const appUrl = await getAppUrl()

          return Response.json({ success: true, url: `${appUrl}/api/uploads/${saved.filename}` })
        } catch (err: any) {
          return Response.json({ error: err.message || 'Upload failed' }, { status: 400 })
        }
      },
    },
  },
})
