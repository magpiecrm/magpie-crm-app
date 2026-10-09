import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react'
import { APP_NAME } from '../../../brand'
import { createApiKeyFn, deleteApiKeyFn, getMcpKeysFn } from '../../../server/functions'
import { Button } from '../../../components/ui/Button'
import { CODE_CLASS, Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'

type McpKey = Awaited<ReturnType<typeof getMcpKeysFn>>['keys'][number]

const SERVER_NAME = APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const KEY_PLACEHOLDER = '<your MCP key>'

/** A key or snippet in a box that scrolls sideways, so a long line never widens the column. */

function CopyBlock({ label, code, note }: { label: string; code: string; note?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          leftIcon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className={`${CODE_CLASS} whitespace-pre`}>{code}</pre>
      {note && <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  )
}

/**
 * Settings → Connect AI apps: keys and copy-paste setup for connecting Claude,
 * ChatGPT/OpenAI, Cursor and other MCP clients to this app's `/api/mcp`.
 */
export function McpTab() {
  const [keys, setKeys] = useState<McpKey[]>([])
  const [name, setName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [origin, setOrigin] = useState('')

  const load = () => getMcpKeysFn().then((r) => setKeys(r.keys)).catch((e) => setError(e?.message || 'Failed to load keys'))
  useEffect(() => {
    setOrigin(window.location.origin)
    load()
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const res: any = await createApiKeyFn({ data: { name: name.trim(), scope: 'mcp' } })
      if (!res.success) throw new Error(res.error)
      setNewKey(res.rawKey)
      setName('')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to create key')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this key? Any AI app using it loses access immediately.')) return
    await deleteApiKeyFn({ data: { id } })
    await load()
  }

  const url = `${origin}/api/mcp`
  const key = newKey ?? KEY_PLACEHOLDER
  const isLocal = /^https?:\/\/(localhost|127\.|\[::1\])/.test(origin)

  const clients: SetupClient[] = [
    {
      id: 'claude-code',
      label: 'Claude Code',
      where: 'Run in a terminal',
      code: `claude mcp add --transport http ${SERVER_NAME} ${url} \\\n  --header "Authorization: Bearer ${key}"`,
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      where: 'claude_desktop_config.json',
      code: JSON.stringify(
        {
          mcpServers: {
            [SERVER_NAME]: {
              command: 'npx',
              args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${MCP_AUTH}'],
              env: { MCP_AUTH: `Bearer ${key}` },
            },
          },
        },
        null,
        2,
      ),
      note: 'Settings → Developer → Edit Config in Claude Desktop, then restart it. Needs Node.js for npx.',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      where: '.cursor/mcp.json',
      code: JSON.stringify({ mcpServers: { [SERVER_NAME]: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2),
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      where: '~/.codex/config.toml',
      code: `[mcp_servers.${SERVER_NAME.replace(/-/g, '_')}]\nurl = "${url}"\nbearer_token_env_var = "MCP_KEY"`,
      note: `Then set MCP_KEY=${newKey ? key : '<your MCP key>'} in the shell Codex runs from.`,
    },
    {
      id: 'openai',
      label: 'OpenAI API',
      where: 'Responses API tools',
      code: `tools: [{\n  type: "mcp",\n  server_label: "${SERVER_NAME}",\n  server_url: "${url}",\n  headers: { Authorization: "Bearer ${key}" },\n  require_approval: "always",\n}]`,
      note: 'OpenAI connects from its own servers, so this needs the app on a public https address.',
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      {error && <Notice level="error">{error}</Notice>}

      <SettingsPanel>
        <SettingsBlock
          title="How it works"
          description="Each app gets its own key, which you can revoke at any time. Apps ask you before running anything that changes data."
        >
          <p className="text-sm leading-relaxed text-foreground">
            Claude, ChatGPT, Cursor and other AI apps use {APP_NAME} through MCP. They can search prospects, manage lists,
            contacts, campaigns, templates, surveys and personas, and design emails and surveys block by block with the
            same builder tools as the copilot.
          </p>
          <Notice>
            A key gives full access to your contacts and can run prospect searches. Data the AI reads is sent to that
            app's provider (Anthropic, OpenAI, …), so list them as sub-processors in your privacy notice.
          </Notice>
        </SettingsBlock>

        <SettingsBlock title="Your keys" description="One key per app, so you can revoke one without touching the others.">
          {keys.length === 0 ? (
            <SettingsEmpty>No keys yet.</SettingsEmpty>
          ) : (
            <SettingsList>
              {keys.map((k) => (
                <SettingsRow
                  key={k.id}
                  icon={<KeyRound className="h-4 w-4" />}
                  title={k.name}
                  detail={
                    <>
                      <span className="font-mono">{k.masked_key}</span> · {k.last_used_at ? `Used ${new Date(k.last_used_at).toLocaleString()}` : 'Never used'}
                    </>
                  }
                  actions={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => revoke(k.id)}
                      aria-label={`Revoke ${k.name}`}
                      title="Revoke"
                      className="hover:!bg-destructive/10 hover:!text-destructive"
                      leftIcon={<Trash2 className="h-4 w-4" />}
                    />
                  }
                />
              ))}
            </SettingsList>
          )}
        </SettingsBlock>

        <SettingsBlock title="Create a key" description="Name it after the app that will use it.">
          <form onSubmit={create} className="flex flex-col gap-3">
            <FieldGrid>
              <Field label="Name">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude Desktop (laptop)" className={INPUT_CLASS} />
              </Field>
            </FieldGrid>
            {newKey && (
              <Notice level="success" title="Copy this key now">
                <div className="flex flex-col gap-2">
                  <p>It won't be shown again. The setup snippets below already include it.</p>
                  <code className={`${CODE_CLASS} block select-all whitespace-nowrap`}>{newKey}</code>
                </div>
              </Notice>
            )}
            <SettingsActions>
              <Button type="submit" isLoading={busy} disabled={!name.trim()} leftIcon={<KeyRound className="h-4 w-4" />}>
                Create key
              </Button>
            </SettingsActions>
          </form>
        </SettingsBlock>

        <SettingsBlock
          title="Set up your app"
          description={
            <>
              <p>
                Anything else that supports MCP over Streamable HTTP works the same way: the server address, plus the
                header <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
              </p>
              <p>
                Adding it as a connector in the ChatGPT app or on claude.ai needs a sign-in flow (OAuth) that isn't built
                yet.
              </p>
            </>
          }
        >
          <Field label="Server address">
            <code className={`${CODE_CLASS} block whitespace-nowrap`}>{url}</code>
          </Field>
          {isLocal && (
            <Notice level="warning">
              This address only works for apps on this computer (Claude Code, Claude Desktop, Cursor, Codex). Apps that
              connect from the cloud (the OpenAI API, ChatGPT, Claude on the web) need this app on a public https address.
            </Notice>
          )}
          <SetupTabs clients={clients} />
        </SettingsBlock>
      </SettingsPanel>
    </div>
  )
}

interface SetupClient {
  id: string
  label: string
  /** Where the snippet goes: a file, or how to run it. */
  where: string
  code: string
  note?: string
}

/** One app's setup at a time, rather than every snippet stacked down the page. */
function SetupTabs({ clients }: { clients: SetupClient[] }) {
  const [active, setActive] = useState(clients[0].id)
  const client = clients.find((c) => c.id === active) ?? clients[0]
  return (
    <div className="flex flex-col gap-3">
      {/* A row of small buttons, the chosen one outlined like a chosen SettingsOption. */}
      <div role="tablist" aria-label="AI app" className="flex flex-wrap gap-1.5">
        {clients.map((c) => (
          <Button
            key={c.id}
            type="button"
            role="tab"
            variant="outline"
            size="sm"
            aria-selected={c.id === client.id}
            onClick={() => setActive(c.id)}
            className={c.id === client.id ? '!border-accent !bg-accent/5' : '!text-muted-foreground hover:!text-foreground'}
          >
            {c.label}
          </Button>
        ))}
      </div>
      <div role="tabpanel">
        <CopyBlock label={client.where} code={client.code} note={client.note} />
      </div>
    </div>
  )
}
