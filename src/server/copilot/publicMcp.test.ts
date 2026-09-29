import { describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

// Nothing here should touch data; the fake db makes sure of it.
vi.mock('../db', () => ({ db: {} }))

const { PUBLIC_TOOLS, buildPublicMcpServer } = await import('./mcp')

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await buildPublicMcpServer().connect(serverSide)
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(clientSide)
  return client
}

describe('public MCP server', () => {
  it('offers the data tools, and the builder tools against a saved design', () => {
    const names = PUBLIC_TOOLS.map((t) => t.name)
    expect(PUBLIC_TOOLS.every((t) => t.target === 'server' && !t.browserOnly)).toBe(true)
    expect(names).toEqual(expect.arrayContaining(['getLists', 'getContacts', 'getCampaigns', 'searchPeople', 'getSavedTemplates', 'listTemplates']))
    // The copilot's builder tools, by the same names, each naming what to work on.
    for (const name of ['getBlocks', 'applyTemplate', 'addBlock', 'updateBlock', 'replaceBlocks', 'addItem', 'setGlobalStyle', 'applyBrandToDesign', 'compileEmail', 'previewEmail']) {
      expect(names).toContain(name)
      expect(Object.keys(PUBLIC_TOOLS.find((t) => t.name === name)!.input)).toEqual(expect.arrayContaining(['campaignId', 'savedTemplateId']))
    }
    for (const name of ['getSurveyDesign', 'addSurveyBlock', 'setSurveyPageLogic', 'previewSurvey']) {
      expect(Object.keys(PUBLIC_TOOLS.find((t) => t.name === name)!.input)).toContain('surveyId')
    }
    // Only the copilot's own change history and the open persona form stay in the app.
    for (const inApp of ['undoLastChange', 'undoSurveyChange', 'getOpenPersona', 'updatePersona']) expect(names).not.toContain(inApp)
    expect(new Set(names).size).toBe(names.length)
  })

  it('lists them over MCP with hints outside apps use to ask before changes', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(PUBLIC_TOOLS.map((t) => t.name).sort())

    const byName = new Map(tools.map((t) => [t.name, t]))
    expect(byName.get('getLists')?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(byName.get('deleteCampaign')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    // Paid searches say so.
    expect(byName.get('searchPeople')?.description).toMatch(/Uses search credits/)
    expect(byName.get('searchPeople')?.annotations?.openWorldHint).toBe(true)
    expect(byName.get('getLists')?.description).not.toMatch(/credits/)
  })

  it('explains credits, and building emails from blocks with the block reference, in its instructions', async () => {
    const client = await connect()
    const instructions = client.getInstructions() ?? ''
    expect(instructions).toMatch(/search credits/)
    expect(instructions).toMatch(/Build emails from blocks, never hand-written HTML/)
    expect(instructions).toMatch(/## Email block model/)
    expect(instructions).toMatch(/## Survey model/)
    expect(instructions).not.toMatch(/SocialFetch/)
  })
})
