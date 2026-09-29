import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Reads and writes the active sending provider. Secret fields are never
// echoed back, only a boolean saying whether they are set.

export const getEmailSettingsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false as const, error: 'Unauthorized' }
    }

    const { getMaskedSettings } = await import('../emailSettings')
    const { PROVIDER_DESCRIPTORS } = await import('../providers/descriptors')

    const { env } = await import('../env')
    return {
      success: true as const,
      providers: PROVIDER_DESCRIPTORS,
      settings: getMaskedSettings(),
      /** The host runs sending through Amazon SES: show sending domains instead. */
      managed: env.sendingManaged(),
      /** WEBHOOK_SECRET is set, so the bounce and complaint webhooks are on. */
      webhooksOn: Boolean(env.webhookSecret()),
    }
  })

export const saveEmailSettingsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: {
    provider: string
    defaultSender?: string
    credentials: Record<string, string>
    clearFields?: string[]
  }) => d)
  .handler(async ({ data }) => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false as const, error: 'Unauthorized' }
    }

    const { env } = await import('../env')
    if (env.sendingManaged()) {
      return { success: false as const, error: "Sending is run by your hosting provider, so it can't be changed here." }
    }
    const { isProviderId, getDescriptor } = await import('../providers/descriptors')
    if (!isProviderId(data.provider)) {
      return { success: false as const, error: `Unknown provider: ${data.provider}` }
    }

    const { saveProviderSettings, getActiveProviderConfig } = await import('../emailSettings')
    const { resetSmtpTransport } = await import('../nodemailer')

    try {
      saveProviderSettings({
        provider: data.provider,
        defaultSender: data.defaultSender,
        credentials: data.credentials ?? {},
        clearFields: data.clearFields,
      })
    } catch (err: any) {
      return { success: false as const, error: err?.message || 'Failed to save settings' }
    }

    // SMTP caches its transport against the credentials it was built from;
    // dropping it here means edits apply without a process restart.
    resetSmtpTransport()

    // Report rather than reject a partial config — it still saves, and sending
    // falls back to mock logging until the missing fields are filled in.
    const active = getActiveProviderConfig()
    const descriptor = getDescriptor(data.provider)
    return {
      success: true as const,
      provider: data.provider,
      label: descriptor?.label ?? data.provider,
      missingFields: active.missingFields,
    }
  })

export const sendProviderTestEmailFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { to: string }) => d)
  .handler(async ({ data }) => {
    try {
      const { requireAuth } = await import('../auth.server')
      await requireAuth()
    } catch (e) {
      return { success: false as const, error: 'Unauthorized' }
    }

    const { sendMail } = await import('../nodemailer')
    const { getActiveProviderConfig } = await import('../emailSettings')
    const { getDescriptor } = await import('../providers/descriptors')

    const { env } = await import('../env')

    const config = getActiveProviderConfig()
    // When the host runs sending, which provider it uses is the host's business.
    const label = env.sendingManaged() ? 'Sending' : (getDescriptor(config.providerId)?.label ?? config.providerId)

    try {
      const result = await sendMail({
        to: data.to,
        subject: env.sendingManaged() ? '[TEST] Sending works' : `[TEST] Sending via ${label}`,
        html:
          `<p>This is a test message from MagpieCRM.</p>` +
          (env.sendingManaged()
            ? `<p>If you are reading it, sending is set up correctly.</p>`
            : `<p>If you are reading it, <strong>${label}</strong> is configured correctly.</p>`),
      })
      return {
        success: true as const,
        provider: label,
        messageId: (result as { messageId?: string })?.messageId ?? '',
      }
    } catch (err: any) {
      // The verbatim provider error is by far the most useful thing we can show
      // here — most setup failures are "domain not verified" style messages.
      return { success: false as const, error: err?.message || String(err) }
    }
  })

// Sending domains, when the host runs sending (SENDING_MANAGED; see sendingDomains.ts).

const DAY_MS = 24 * 60 * 60_000

/** Each domain with its DNS records; checks again any not ready yet, and any not checked for a day. */
export const getSendingDomainsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../auth.server')
  await requireAuth()
  const { checkSendingDomain, getSendingDomains, isReady } = await import('../sendingDomains')
  const now = Date.now()
  const domains = await Promise.all(
    getSendingDomains().map(async (d) => {
      const stale = !isReady(d) || !d.checkedAt || now - Date.parse(d.checkedAt) > DAY_MS
      return stale ? checkSendingDomain(d.domain).catch(() => d) : d
    }),
  )
  return domains
})

export const addSendingDomainFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { domain: string }) => z.object({ domain: z.string().max(260) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { env } = await import('../env')
    if (!env.sendingManaged()) return { success: false as const, error: 'Sending domains are only used when your host runs sending.' }
    const { addSendingDomain } = await import('../sendingDomains')
    try {
      const d = await addSendingDomain(data.domain)
      return { success: true as const, domain: d.domain }
    } catch (err: any) {
      return { success: false as const, error: err?.message || 'Could not add that domain' }
    }
  })

export const checkSendingDomainFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { domain: string }) => z.object({ domain: z.string().max(260) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { checkSendingDomain, isReady } = await import('../sendingDomains')
    try {
      return { success: true as const, ready: isReady(await checkSendingDomain(data.domain)) }
    } catch (err: any) {
      return { success: false as const, error: err?.message || 'Could not check that domain' }
    }
  })

export const removeSendingDomainFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { domain: string }) => z.object({ domain: z.string().max(260) }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { removeSendingDomain } = await import('../sendingDomains')
    await removeSendingDomain(data.domain)
    return { success: true as const }
  })
