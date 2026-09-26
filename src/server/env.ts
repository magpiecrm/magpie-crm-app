// Centralized access to server-side configuration: external API base URLs and
// the secrets needed to talk to them. Keep all `process.env` reads here so the
// rest of the server layer stays declarative.

function readEnv(name: string): string | undefined {
  return process.env[name] ?? (globalThis as any).Bun?.env?.[name]
}

function requireEnv(name: string): string {
  const value = readEnv(name)
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

// Development-only fallback for the signing/encryption secrets below. A default
// that ships in public source is a key every reader already has, so production
// refuses it outright instead of silently encrypting credentials with it.
const DEV_ONLY_SECRET = 'dev-only-insecure-secret-do-not-use-in-production'

function secretWithDevFallback(...names: string[]): string {
  for (const name of names) {
    const value = readEnv(name)
    if (value) return value
  }
  if (readEnv('NODE_ENV') === 'production') {
    throw new Error(
      `Missing required environment variable: set ${names.join(' or ')} ` +
        '(generate one with `openssl rand -hex 32`)',
    )
  }
  return DEV_ONLY_SECRET
}

/** Comma-separated env var as a trimmed, non-empty list. */
function readList(name: string): string[] {
  return (readEnv(name) || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export const env = {
  // SMTP is now just one of several sending providers, so none of these may be
  // assumed present — a deployment on Resend or SES has no SMTP_* vars at all.
  // They survive as the back-compat fallback in emailSettings.ts.
  smtp: {
    host: () => readEnv('SMTP_HOST'),
    port: () => {
      const raw = readEnv('SMTP_PORT')
      const parsed = raw ? parseInt(raw, 10) : NaN
      return Number.isNaN(parsed) ? undefined : parsed
    },
    user: () => readEnv('SMTP_USER'),
    pass: () => readEnv('SMTP_PASS') || '',
    sender: () => readEnv('SMTP_SENDER'),
  },
  // SocialFetch is the only source of company and people data. Every call
  // goes through `prospecting/socialfetch.ts`, never directly. The key is
  // normally saved in Settings → Prospecting; this env var is the fallback
  // (see prospecting/settings.ts).
  socialfetch: {
    baseUrl: () => readEnv('SOCIALFETCH_BASE_URL') || 'https://api.socialfetch.dev',
    apiKey: () => readEnv('SOCIALFETCH_API_KEY'),
  },
  // Anthropic API key for the copilot (bring your own key). Normally saved in
  // Settings → Copilot; this env var is the fallback (see copilot/settings.ts).
  anthropic: {
    apiKey: () => readEnv('ANTHROPIC_API_KEY'),
  },
  // OpenAI API key, the copilot's other bring-your-own-key option (see
  // copilot/openai.ts). Also normally saved in Settings → Copilot.
  openai: {
    apiKey: () => readEnv('OPENAI_API_KEY'),
  },
  // Reacher (reacherhq/check-if-email-exists) runs as its own service. Optional:
  // without it, email finding falls back to an unverified best-guess candidate.
  // URL, secret, FROM and HELO can also be set in Settings → Prospecting.
  reacher: {
    url: () => readEnv('REACHER_URL')?.replace(/\/+$/, ''),
    secret: () => readEnv('REACHER_SECRET'),
    fromEmail: () => readEnv('REACHER_FROM_EMAIL'),
    helloName: () => readEnv('REACHER_HELLO_NAME'),
    /**
     * SOCKS5 proxies for SMTP verification, as a JSON array of
     * `{ "host", "port", "username"?, "password"?, "label"? }`. Unset means
     * Reacher connects directly (which needs outbound port 25 on its host).
     */
    proxies: () => readEnv('REACHER_PROXIES'),
  },
  auth: {
    email: () => requireEnv('AUTH_EMAIL'),
    password: () => requireEnv('AUTH_PASSWORD'),
  },
  // Web Push (VAPID). Generate a keypair with `npx web-push generate-vapid-keys`.
  // Optional: absent keys just mean push is disabled, not that the app fails.
  vapid: {
    publicKey: () => readEnv('VAPID_PUBLIC_KEY'),
    privateKey: () => readEnv('VAPID_PRIVATE_KEY'),
    // Push services want a contact for the sender; the admin login is the
    // natural one when no dedicated address is configured.
    subject: () => {
      const explicit = readEnv('VAPID_SUBJECT')
      if (explicit) return explicit
      const admin = readEnv('AUTH_EMAIL')
      return admin ? `mailto:${admin}` : 'mailto:admin@example.com'
    },
    isConfigured: () => Boolean(readEnv('VAPID_PUBLIC_KEY') && readEnv('VAPID_PRIVATE_KEY')),
  },
  cloudflare: {
    apiToken: () => readEnv('CLOUDFLARE_API_TOKEN'),
    accountId: () => readEnv('CLOUDFLARE_ACCOUNT_ID'),
    zoneId: () => readEnv('CLOUDFLARE_ZONE_ID'),
  },
  trackingSecret: () => secretWithDevFallback('TRACKING_SECRET'),
  // Key for provider credentials stored in the DB. Prefers a dedicated secret
  // but falls back to TRACKING_SECRET so a single secret is enough to start.
  // Rotating either one makes stored credentials undecryptable, which
  // emailSettings.ts detects via a fingerprint rather than failing silently.
  credentialsSecret: () => secretWithDevFallback('CREDENTIALS_SECRET', 'TRACKING_SECRET'),
  usingDefaultCredentialsSecret: () =>
    !readEnv('CREDENTIALS_SECRET') && !readEnv('TRACKING_SECRET'),
  // Keys the HMAC hashes in the suppression list and disclosure log. Rotating
  // it orphans every stored hash — opted-out people would reappear in search —
  // so set it once, up front.
  suppressionSecret: () => secretWithDevFallback('SUPPRESSION_SECRET', 'TRACKING_SECRET'),
  webhookSecret: () => readEnv('WEBHOOK_SECRET'),
  isProduction: () => readEnv('NODE_ENV') === 'production',
  // Where the JSON "database" lives — also used to derive the uploads
  // directory, so uploaded files land on the same persistent volume as the DB
  // in production without needing a separate path to configure.
  databasePath: () => readEnv('DATABASE_PATH'),
  // Absolute origin the server should use when it builds a URL meant for a
  // third party to fetch (an email client, a webhook). Falls back to the
  // incoming request's own host when unset — see appUrl.ts.
  publicUrl: () => readEnv('PUBLIC_URL'),
  // The deployment's own marketing site — where the unsubscribe page's
  // "back to site" button goes. Unset hides the button.
  siteUrl: () => readEnv('PUBLIC_SITE_URL'),
  // Origins allowed to call the public /api/subscribe endpoint (a signup form
  // embedded on your website). Unset allows none, so the endpoint is closed by
  // default rather than open to every site.
  subscribeAllowedOrigins: () => readList('SUBSCRIBE_ALLOWED_ORIGINS'),
}
