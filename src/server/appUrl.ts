// Resolves the app's own public base URL — needed anywhere the server builds
// a URL meant to be dereferenced by a third party (an email client fetching an
// image, a webhook target) rather than the browser that made the request.
import { env } from './env'

export async function getAppUrl(): Promise<string> {
  const configured = env.publicUrl()
  if (configured) return configured.replace(/\/$/, '')

  try {
    const { getRequest } = await import('@tanstack/react-start/server')
    const req = getRequest()
    if (req) {
      const url = new URL(req.url)
      const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '') || 'http'
      const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host
      if (host) return `${proto}://${host}`
    }
  } catch {
    // getRequest() can throw or return nothing outside a request context
    // (e.g. a background job), so falling through to localhost is expected.
  }

  return 'http://localhost:3000'
}
