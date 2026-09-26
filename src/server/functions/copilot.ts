import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// The agent loop that used to live here — a one-shot `claude -p` invocation
// whose reply was scraped for a JSON blob, re-spawned once per tool call — has
// been replaced by `src/server/copilot/`: a long-lived CLI session driven over
// stream-json, with the platform's actions exposed as real MCP tools. See
// `src/routes/api/copilot/stream.ts` for the entry point.
//
// What remains here is the copilot's settings: the user's own Anthropic API
// key, which the CLI runs with (see `copilot/settings.ts`). The app no longer
// signs the CLI in to a Claude.ai account: Anthropic doesn't allow products to
// offer or relay Claude.ai login, or to share one subscription between users.

export const getCopilotSettingsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { getMaskedCopilotSettings } = await import('../copilot/settings')
    return getMaskedCopilotSettings()
  })

export const saveCopilotSettingsFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { anthropicApiKey?: string; clear?: Array<'anthropicApiKey'> }) =>
    z
      .object({
        anthropicApiKey: z.string().trim().max(300).optional(),
        clear: z.array(z.literal('anthropicApiKey')).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { saveCopilotSettings, getMaskedCopilotSettings } = await import('../copilot/settings')
    saveCopilotSettings(data)
    return getMaskedCopilotSettings()
  })

/** Checks the typed key (or the saved one) against Anthropic with a free call. */
export const testAnthropicKeyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { apiKey?: string }) => z.object({ apiKey: z.string().trim().max(300).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { testAnthropicKey } = await import('../copilot/settings')
    return testAnthropicKey(data.apiKey)
  })

export const getCopilotProvidersFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { listProviders } = await import('../copilot/providers')
    const { PERMISSION_MODES, DEFAULT_PERMISSION_MODE } = await import('../copilot/permissions')
    return {
      providers: await listProviders(),
      permissionModes: PERMISSION_MODES,
      defaultPermissionMode: DEFAULT_PERMISSION_MODE,
    }
  })

export const listCopilotChatsFn = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { db } = await import('../db')
    return { chats: db.getCopilotChats() }
  })

export const getCopilotChatFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { db } = await import('../db')
    const chat = db.getCopilotChat(data.id)
    if (!chat) return { chat: null }
    return {
      chat: {
        id: chat.id,
        title: chat.title,
        messages: chat.messages,
        updatedAt: chat.updated_at,
      },
    }
  })

export const deleteCopilotChatFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { requireAuth } = await import('../auth.server')
    await requireAuth()
    const { db } = await import('../db')
    const { stopSession } = await import('../copilot/session')
    const { endSession } = await import('../copilot/state')
    // Kill the agent process too, or it lingers until the idle sweep.
    stopSession(data.id)
    endSession(data.id)
    db.deleteCopilotChat(data.id)
    return { success: true }
  })
