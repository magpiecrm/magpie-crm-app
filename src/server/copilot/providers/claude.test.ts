import { describe, expect, it } from 'vitest'
import { claudeProvider } from './claude'

const line = (msg: unknown) => JSON.stringify(msg)

describe('claude provider: API key problems', () => {
  it('stops at the first rejected key instead of letting the CLI retry for minutes', () => {
    expect(claudeProvider.parseLine(line({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 401, error: 'authentication_failed' }))).toEqual([
      { type: 'error', fatal: true, message: expect.stringMatching(/Settings → Copilot/) },
    ])
    expect(claudeProvider.parseLine(line({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 403 }))[0]).toMatchObject({
      type: 'error',
      fatal: true,
    })
  })

  it('leaves passing problems (rate limits, overload) to the CLI\'s own retries', () => {
    expect(claudeProvider.parseLine(line({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 429 }))).toEqual([])
    expect(claudeProvider.parseLine(line({ type: 'system', subtype: 'api_retry', attempt: 2, error_status: 529 }))).toEqual([])
  })

  it('always runs with no built-in tools, only this app\'s MCP server, and no permission prompts', () => {
    const args = claudeProvider.buildArgs({ sessionId: 's', systemPrompt: 'p', mcpUrl: 'http://x/mcp', mcpToken: 't', resume: false })
    expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--tools', '', '--permission-mode', 'bypassPermissions']))
  })
})
