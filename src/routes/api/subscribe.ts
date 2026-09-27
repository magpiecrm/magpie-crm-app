import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../server/db'
import { env } from '../../server/env'

/**
 * CORS for the embeddable signup form. Only origins listed in
 * SUBSCRIBE_ALLOWED_ORIGINS get an Allow-Origin header; any other origin gets
 * none, which is how the browser is told to block it. `Vary: Origin` keeps a
 * cache from serving one origin's answer to another.
 */
function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || ''
  const allowed = env.subscribeAllowedOrigins().includes(origin)
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    Vary: 'Origin',
  }
}

export const Route = createFileRoute('/api/subscribe')({
  server: {
    handlers: {
      OPTIONS: async ({ request }: { request: Request }) => {
        return new Response(null, { status: 200, headers: corsHeadersFor(request) })
      },
      POST: async ({ request }: { request: Request }) => {
        const corsHeaders = {
          ...corsHeadersFor(request),
          'Content-Type': 'application/json',
        }

        // 1. Auth Check
        const apiKey = request.headers.get('X-API-Key')
        const isValidKey = apiKey ? db.verifyApiKey(apiKey) : false
        if (!apiKey || !isValidKey) {
          return new Response(
            JSON.stringify({ success: false, error: 'Unauthorized' }),
            {
              status: 401,
              headers: corsHeaders,
            }
          )
        }

        // 2. Request body parsing and validation
        let body: any
        try {
          body = await request.json()
        } catch (e) {
          return new Response(
            JSON.stringify({ success: false, error: 'Invalid JSON body' }),
            {
              status: 400,
              headers: corsHeaders,
            }
          )
        }

        const { email, first_name, last_name, company } = body
        if (!email || !first_name) {
          return new Response(
            JSON.stringify({ success: false, error: 'email and first_name are required' }),
            {
              status: 400,
              headers: corsHeaders,
            }
          )
        }

        // 3. Database inserts
        try {
          const normalizedEmail = email.toLowerCase().trim()

          // Wrap inside try/catch as requested. We can also use db.transaction.
          db.transaction(() => {
            db.run(
              "INSERT OR IGNORE INTO contacts (email, first_name, last_name, company, status, created_at) VALUES (?, ?, ?, ?, 'subscribed', datetime('now'))",
              [normalizedEmail, first_name, last_name || '', company || '']
            )

            db.run(
              "INSERT OR IGNORE INTO list_contacts (list_id, contact_email) VALUES (1, ?)",
              [normalizedEmail]
            )
          })()
          // They signed themselves up: consent that outlasts an earlier opt-out from prospecting.
          db.markSignedUp(normalizedEmail)

          return new Response(
            JSON.stringify({ success: true }),
            {
              status: 200,
              headers: corsHeaders,
            }
          )
        } catch (err) {
          console.error('Error in /api/subscribe:', err)
          return new Response(
            JSON.stringify({ success: false, error: 'Internal server error' }),
            {
              status: 500,
              headers: corsHeaders,
            }
          )
        }
      },
    },
  },
})
