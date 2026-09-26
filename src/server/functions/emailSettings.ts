import { createServerFn } from '@tanstack/react-start'

// Reads and writes the active sending provider. Note the deliberate difference
// from `getEnvVarsFn`, which returns secrets in plaintext: here secret fields
// are never echoed back, only a boolean saying whether they are set.

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

    return {
      success: true as const,
      providers: PROVIDER_DESCRIPTORS,
      settings: getMaskedSettings(),
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

    const config = getActiveProviderConfig()
    const label = getDescriptor(config.providerId)?.label ?? config.providerId

    try {
      const result = await sendMail({
        to: data.to,
        subject: `[TEST] Sending via ${label}`,
        html:
          `<p>This is a test message from MagpieCRM.</p>` +
          `<p>If you are reading it, <strong>${label}</strong> is configured correctly.</p>`,
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
