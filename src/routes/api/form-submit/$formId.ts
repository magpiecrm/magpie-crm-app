import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../../server/db'
import { notify } from '../../../server/notify'

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }
}

export const Route = createFileRoute('/api/form-submit/$formId')({
  server: {
    handlers: {
      OPTIONS: async ({ request }: { request: Request }) => {
        const origin = request.headers.get('origin') || '*'
        return new Response(null, { status: 200, headers: corsHeaders(origin) })
      },
      POST: async ({ request, params }: { request: Request; params: { formId: string } }) => {
        const origin = request.headers.get('origin') || '*'
        const headers = corsHeaders(origin)

        const form = db.getForm(params.formId)
        if (!form) {
          return new Response(JSON.stringify({ success: false, error: 'Form not found' }), { status: 404, headers })
        }

        let body: Record<string, string>
        try {
          body = await request.json()
        } catch {
          return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), { status: 400, headers })
        }

        const email = (body.email || '').toLowerCase().trim()
        const firstName = (body.first_name || '').trim()
        const lastName = (body.last_name || '').trim()
        const company = (body.company || '').trim()
        const message = (body.message || '').trim()

        if (!email || !firstName) {
          return new Response(
            JSON.stringify({ success: false, error: 'email and first_name are required' }),
            { status: 400, headers }
          )
        }

        try {
          if (form.save_to_list_enabled !== false && form.list_id) {
            const saveFields = form.save_to_list_fields || ['first_name', 'last_name', 'company']
            db.transaction(() => {
              db.run(
                "INSERT OR IGNORE INTO contacts (email, first_name, last_name, company, status, created_at) VALUES (?, ?, ?, ?, 'subscribed', datetime('now'))",
                [
                  email,
                  saveFields.includes('first_name') ? firstName : '',
                  saveFields.includes('last_name') ? lastName : '',
                  saveFields.includes('company') ? company : '',
                ]
              )
              db.run(
                'INSERT OR IGNORE INTO list_contacts (list_id, contact_email) VALUES (?, ?)',
                [form.list_id, email]
              )
            })()
          }

          db.addFormSubmission(params.formId, email, message)
          notify(
            'form_submission',
            `${firstName} ${lastName} submitted "${form.name}"`.trim(),
            { contactEmail: email, url: `/marketing/forms/${params.formId}` },
          )

          if (form.welcome_email_enabled && form.welcome_email_subject) {
            const emailBody = form.welcome_email_body
              .replace(/\{\{first_name\}\}/g, firstName)
              .replace(/\{\{last_name\}\}/g, lastName)
            const html = `<div style="font-family:inherit;line-height:1.6">${emailBody.replace(/\n/g, '<br/>')}</div>`

            let from: string | undefined
            if (form.sender_id) {
              const sender = db.data.senders.find(s => s.id === form.sender_id)
              if (sender) from = `"${sender.name}" <${sender.email}>`
            }

            db.addPendingEmail(
              email,
              firstName,
              form.welcome_email_subject,
              html,
              form.welcome_email_delay_minutes * 60 * 1000,
              from
            )
          }

          return new Response(JSON.stringify({ success: true }), { status: 200, headers })
        } catch (err) {
          console.error('[form-submit] Error:', err)
          return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), { status: 500, headers })
        }
      },
    },
  },
})
