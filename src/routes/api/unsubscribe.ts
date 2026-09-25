import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../server/db'
import { getLists } from '../../server/emailService'
import { decryptToken } from '../../server/crypto'
import { env } from '../../server/env'

/**
 * The deployment's own website, for the "back to site" link after
 * unsubscribing. Only http(s) URLs are accepted so a misconfigured value can't
 * become a `javascript:` link; anything else means no link at all.
 */
function safeSiteUrl(): string | null {
  const raw = env.siteUrl()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const Route = createFileRoute('/api/unsubscribe')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const url = new URL(request.url)
        const token = url.searchParams.get('t') || ''
        
        let decodedEmail = ''
        if (token) {
          const decrypted = decryptToken(token)
          if (decrypted) {
            decodedEmail = decrypted.email || ''
          }
        }

        if (!decodedEmail) {
          return new Response(
            `<!DOCTYPE html>
            <html lang="en">
              <head>
                <title>Invalid Request</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                  body {
                    font-family: system-ui, sans-serif;
                    background-color: #09090b;
                    color: #f4f4f5;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                  }
                  .card {
                    background-color: #18181b;
                    border: 1px solid #27272a;
                    border-radius: 20px;
                    padding: 40px;
                    max-width: 480px;
                    width: 100%;
                    text-align: center;
                  }
                  h2 { color: #ef4444; }
                  p { color: #a1a1aa; }
                </style>
              </head>
              <body>
                <div class="card">
                  <h2>Invalid Unsubscribe Link</h2>
                  <p>The unsubscribe link is invalid or expired. If you wish to unsubscribe, please contact support.</p>
                </div>
              </body>
            </html>`,
            {
              status: 400,
              headers: { 'Content-Type': 'text/html' },
            }
          )
        }

        const siteUrl = safeSiteUrl()

        return new Response(
          `<!DOCTYPE html>
          <html lang="en">
            <head>
              <title>Unsubscribe Confirmation</title>
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
              <style>
                :root {
                  --bg: #09090b;
                  --card: #18181b;
                  --border: #27272a;
                  --text: #f4f4f5;
                  --muted: #a1a1aa;
                  --primary: #3b82f6;
                  --primary-hover: #2563eb;
                  --success: #10b981;
                  --error: #ef4444;
                }

                * {
                  box-sizing: border-box;
                  margin: 0;
                  padding: 0;
                }

                body {
                  font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  background-color: var(--bg);
                  color: var(--text);
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  padding: 24px;
                }

                .card {
                  background-color: var(--card);
                  border: 1px solid var(--border);
                  border-radius: 20px;
                  padding: 40px;
                  max-width: 480px;
                  width: 100%;
                  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4);
                  text-align: center;
                  position: relative;
                  overflow: hidden;
                  transition: transform 0.3s ease;
                }

                .card::before {
                  content: '';
                  position: absolute;
                  top: 0;
                  left: 0;
                  right: 0;
                  height: 4px;
                  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
                }

                .icon-container {
                  width: 64px;
                  height: 64px;
                  background-color: rgba(59, 130, 246, 0.1);
                  border-radius: 50%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  margin: 0 auto 24px auto;
                  color: var(--primary);
                }

                .icon-container.success {
                  background-color: rgba(16, 185, 129, 0.1);
                  color: var(--success);
                  display: none;
                }

                h2 {
                  font-size: 24px;
                  font-weight: 600;
                  margin-bottom: 12px;
                  letter-spacing: -0.5px;
                }

                p {
                  color: var(--muted);
                  font-size: 15px;
                  line-height: 1.6;
                  margin-bottom: 32px;
                }

                .form-group {
                  text-align: left;
                  margin-bottom: 24px;
                }

                label {
                  display: block;
                  font-size: 12px;
                  font-weight: 600;
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
                  margin-bottom: 8px;
                  color: var(--muted);
                }

                input[type="email"] {
                  width: 100%;
                  padding: 14px 16px;
                  background-color: rgba(0, 0, 0, 0.2);
                  border: 1px solid var(--border);
                  border-radius: 12px;
                  color: var(--text);
                  font-size: 15px;
                  font-family: inherit;
                  outline: none;
                  transition: border-color 0.2s, box-shadow 0.2s;
                }

                input[type="email"]:focus {
                  border-color: var(--primary);
                  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
                }

                .btn {
                  width: 100%;
                  padding: 14px;
                  background-color: var(--primary);
                  color: white;
                  border: none;
                  border-radius: 12px;
                  font-size: 15px;
                  font-weight: 600;
                  cursor: pointer;
                  transition: background-color 0.2s, transform 0.1s;
                }

                .btn:hover {
                  background-color: var(--primary-hover);
                }

                .btn:active {
                  transform: scale(0.98);
                }

                .btn:disabled {
                  opacity: 0.5;
                  cursor: not-allowed;
                }

                #success-state {
                  display: none;
                }

                /* Animations */
                @keyframes scaleIn {
                  from { transform: scale(0.9); opacity: 0; }
                  to { transform: scale(1); opacity: 1; }
                }

                .animated {
                  animation: scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
                }
              </style>
            </head>
            <body>
              <div class="card">
                <!-- Info / Form State -->
                <div id="form-state" class="animated">
                  <div class="icon-container">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 21.5h-8a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2h18a2 2 0 0 1 2 2v8.5"/><path d="m22 22-1.5-1.5"/><circle cx="18" cy="18" r="3"/><path d="M2.5 5.5l9.5 6 9.5-6"/></svg>
                  </div>
                  <h2>Unsubscribe Confirmation</h2>
                  <p>Confirm your email below to unsubscribe from our newsletter subscriber list.</p>
                  
                  <form id="unsub-form" onsubmit="handleUnsubscribe(event)">
                    <input type="hidden" id="token" value="${token}" />
                    <div class="form-group">
                      <label for="email">Email Address</label>
                      <input type="email" id="email" value="${decodedEmail}" placeholder="name@company.com" required readonly />
                    </div>
                    <button type="submit" id="submit-btn" class="btn">Unsubscribe</button>
                  </form>
                </div>

                <!-- Success State -->
                <div id="success-state">
                  <div class="icon-container success" style="display: flex;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  </div>
                  <h2>Unsubscribed Successfully</h2>
                  <p>You have been removed from the newsletter list and moved to the unsubscribe list.${siteUrl ? ' You will be redirected shortly...' : ''}</p>
                  ${siteUrl ? `<a href="${escapeAttr(siteUrl)}" class="btn" style="display: inline-block; text-decoration: none; background-color: var(--border); color: var(--text);">Back to website</a>` : ''}
                </div>
              </div>

              <script>
                async function handleUnsubscribe(e) {
                  e.preventDefault();
                  const tokenInput = document.getElementById('token');
                  const submitBtn = document.getElementById('submit-btn');
                  const token = tokenInput.value.trim();

                  if (!token) return;

                  submitBtn.disabled = true;
                  submitBtn.innerText = 'Processing...';

                  try {
                    const response = await fetch('/api/unsubscribe', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({ token })
                    });

                    if (response.ok) {
                      document.getElementById('form-state').style.display = 'none';
                      const successState = document.getElementById('success-state');
                      successState.style.display = 'block';
                      successState.classList.add('animated');
                      ${siteUrl ? `setTimeout(() => {
                        window.location.href = ${JSON.stringify(siteUrl).replace(/</g, '\\u003c')};
                      }, 2000);` : ''}
                    } else {
                      const data = await response.json();
                      alert(data.error || 'Something went wrong. Please try again.');
                      submitBtn.disabled = false;
                      submitBtn.innerText = 'Unsubscribe';
                    }
                  } catch (err) {
                    alert('Network error. Please try again later.');
                    submitBtn.disabled = false;
                    submitBtn.innerText = 'Unsubscribe';
                  }
                }
              </script>
            </body>
          </html>`,
          {
            headers: { 'Content-Type': 'text/html' },
          }
        )
      },
      POST: async ({ request }: { request: Request }) => {
        try {
          const body = await request.json()
          const token = body.token
          if (!token) {
            return new Response(
              JSON.stringify({ error: 'Token is required' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const decrypted = decryptToken(token)
          if (!decrypted || !decrypted.email) {
            return new Response(
              JSON.stringify({ error: 'Invalid or expired unsubscribe token' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            )
          }

          const email = decrypted.email.toLowerCase().trim()
          const campaignId = decrypted.campaignId

          // 1. Fetch lists using getLists()
          const { lists } = await getLists()
          const newsletterList = lists.find((l: any) => 
            l.name.toLowerCase().includes('newsletter') || 
            l.name.toLowerCase().includes('synced') ||
            l.name.toLowerCase().includes('default')
          ) || lists[0]

          if (newsletterList) {
            // Delete contact link from the newsletter list
            db.run(
              "DELETE FROM list_contacts WHERE list_id = ? AND contact_email = ?",
              [newsletterList.id, email]
            )
          }

          // 2. Find or create the "Unsubscribed List"
          let unsubList = lists.find((l: any) => 
            l.name.toLowerCase() === 'unsubscribed list' || 
            l.name.toLowerCase() === 'unsubscribed'
          )
          if (!unsubList) {
            db.run(
              "INSERT INTO lists (name, created_at) VALUES (?, ?)",
              ['Unsubscribed List', new Date().toISOString()]
            )
            const updatedLists = (await getLists()).lists
            unsubList = updatedLists.find((l: any) => l.name === 'Unsubscribed List')
          }

          if (unsubList) {
            // Insert contact link into the Unsubscribed list
            db.run(
              "INSERT OR IGNORE INTO list_contacts (list_id, contact_email) VALUES (?, ?)",
              [unsubList.id, email]
            )
          }

          // 3. Update global contact status to unsubscribed
          db.run(
            "UPDATE contacts SET status = ? WHERE email = ?",
            ['unsubscribed', email]
          )

          // 4. Mark this recipient unsubscribed on the campaign that sent the
          // link, so campaign stats reflect it.
          db.markRecipientUnsubscribed(email, campaignId)

          return new Response(
            JSON.stringify({ success: true }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        } catch (e: any) {
          return new Response(
            JSON.stringify({ error: e.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          )
        }
      }
    },
  },
})
