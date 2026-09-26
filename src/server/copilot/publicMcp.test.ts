import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

// Nothing here should touch data; the fake db makes sure of it.
vi.mock('../db', () => ({ db: {} }))

const { PUBLIC_TOOLS, buildPublicMcpServer } = await import('./mcp')
const { COPILOT_TOOLS } = await import('./tools')

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await buildPublicMcpServer().connect(serverSide)
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(clientSide)
  return client
}

describe('public MCP server', () => {
  it('offers only the tools that work without a browser', () => {
    const names = PUBLIC_TOOLS.map((t) => t.name)
    expect(PUBLIC_TOOLS.every((t) => t.target === 'server' && !t.browserOnly)).toBe(true)
    // Browser-bound builder tools stay inside the app.
    for (const inApp of ['getBlocks', 'compileEmail', 'previewEmail', 'getOpenPersona', 'getSurveyDesign', 'previewSurvey']) {
      expect(names).not.toContain(inApp)
    }
    expect(names).toEqual(expect.arrayContaining(['getLists', 'getContacts', 'getCampaigns', 'searchPeople', 'getSavedTemplates']))
    // Every client-target tool is excluded.
    const clientTools = COPILOT_TOOLS.filter((t) => t.target === 'client').map((t) => t.name)
    expect(clientTools.length).toBeGreaterThan(0)
    expect(names.some((n) => clientTools.includes(n))).toBe(false)
  })

  it('lists them over MCP with hints outside apps use to ask before changes', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(PUBLIC_TOOLS.map((t) => t.name).sort())

    const byName = new Map(tools.map((t) => [t.name, t]))
    expect(byName.get('getLists')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(byName.get('deleteCampaign')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    // Paid searches say so.
    expect(byName.get('searchPeople')?.description).toMatch(/Spends SocialFetch credits/)
    expect(byName.get('searchPeople')?.annotations?.openWorldHint).toBe(true)
    expect(byName.get('getLists')?.description).not.toMatch(/credits/)
  })

  it('explains the credit cost in its instructions', async () => {
    const client = await connect()
    expect(client.getInstructions()).toMatch(/SocialFetch credits/)
  })
})
