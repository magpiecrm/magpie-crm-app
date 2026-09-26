import { useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { APP_NAME } from '../../../brand'
import { createApiKeyFn, deleteApiKeyFn, getMcpKeysFn } from '../../../server/functions'

type McpKey = Awaited<ReturnType<typeof getMcpKeysFn>>['keys'][number]

const SERVER_NAME = APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const KEY_PLACEHOLDER = '<your MCP key>'

function CopyBlock({ label, code, note }: { label: string; code: string; note?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11px] leading-relaxed bg-muted/50 border border-border rounded-md-s p-3 overflow-x-auto whitespace-pre font-mono text-foreground">
        {code}
      </pre>
      {note && <p className="text-[11px] text-muted-foreground leading-snug">{note}</p>}
    </div>
  )
}

/**
 * Settings → AI apps (MCP): keys and copy-paste setup for connecting Claude,
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Connect AI apps
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Let Claude, ChatGPT, Cursor and other AI apps use {APP_NAME} through MCP: search prospects, manage lists,
          contacts, campaigns, templates, surveys and personas. Each app gets its own key, which you can revoke at any
          time. Apps ask you before running anything that changes data.
        </p>
        <div className="flex items-start gap-2.5 p-3 bg-accent/5 border border-accent/15 rounded-md-s text-xs text-accent max-w-2xl">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            A key gives full access to your contacts and can spend SocialFetch credits on searches. Data the AI reads is
            sent to that app's provider (Anthropic, OpenAI, …), so list them as sub-processors in your privacy notice.
          </span>
        </div>
      </div>

      {/* Keys */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          MCP keys
        </h4>
        <form onSubmit={create} className="flex flex-wrap gap-2 max-w-xl">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name, e.g. Claude Desktop (laptop)"
            className="flex-1 min-w-[12rem] bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="py-2 px-3 bg-accent hover:bg-accent/95 disabled:opacity-50 text-accent-foreground text-sm font-semibold rounded-md-s inline-flex items-center gap-2"
          >
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Create key
          </button>
        </form>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {newKey && (
          <div className="max-w-2xl p-3 border border-emerald-500/30 bg-emerald-500/10 rounded-md-s flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              Copy this key now. It won't be shown again; the setup snippets below already include it.
            </span>
            <code className="text-xs font-mono break-all text-foreground">{newKey}</code>
          </div>
        )}
        {keys.length > 0 && (
          <div className="max-w-2xl border border-border rounded-md-s divide-y divide-border">
            {keys.map((k) => (
              <div key={k.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">{k.name}</p>
                  <p className="text-muted-foreground font-mono">{k.masked_key}</p>
                </div>
                <span className="text-muted-foreground whitespace-nowrap">
                  {k.last_used_at ? `Used ${new Date(k.last_used_at).toLocaleString()}` : 'Never used'}
                </span>
                <button type="button" onClick={() => revoke(k.id)} className="p-1.5 text-muted-foreground hover:text-destructive" title="Revoke">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Setup */}
      <div className="flex flex-col gap-4 max-w-3xl">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">
          Set up
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Server address: <code className="font-mono text-foreground">{url}</code>
          {isLocal &&
            ' — that only works for apps on this computer (Claude Code, Claude Desktop, Cursor, Codex). Apps that connect from the cloud (the OpenAI API, ChatGPT, Claude on the web) need this app on a public https address.'}
        </p>

        <CopyBlock
          label="Claude Code"
          code={`claude mcp add --transport http ${SERVER_NAME} ${url} \\\n  --header "Authorization: Bearer ${key}"`}
        />
        <CopyBlock
          label="Claude Desktop (claude_desktop_config.json)"
          code={JSON.stringify(
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
          )}
          note="Settings → Developer → Edit Config in Claude Desktop, then restart it. Needs Node.js for npx."
        />
        <CopyBlock
          label="Cursor (.cursor/mcp.json)"
          code={JSON.stringify({ mcpServers: { [SERVER_NAME]: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)}
        />
        <CopyBlock
          label="OpenAI Codex CLI (~/.codex/config.toml)"
          code={`[mcp_servers.${SERVER_NAME.replace(/-/g, '_')}]\nurl = "${url}"\nbearer_token_env_var = "MCP_KEY"`}
          note={`Then set MCP_KEY=${newKey ? key : '<your MCP key>'} in the shell Codex runs from.`}
        />
        <CopyBlock
          label="OpenAI API (Responses)"
          code={`tools: [{\n  type: "mcp",\n  server_label: "${SERVER_NAME}",\n  server_url: "${url}",\n  headers: { Authorization: "Bearer ${key}" },\n  require_approval: "always",\n}]`}
          note="OpenAI connects from its own servers, so this needs the app on a public https address."
        />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Anything else that supports MCP over Streamable HTTP works the same way: the address above, plus the header{' '}
          <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. Adding it as a connector in the ChatGPT
          app or on claude.ai needs a sign-in flow (OAuth) that isn't built yet.
        </p>
      </div>
    </div>
  )
}
