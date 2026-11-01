import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Deleting a list, on a real (scratch) database: it really goes, or nothing
// changes and the user is told what still needs it.

const scratchDir = mkdtempSync(join(tmpdir(), 'list-delete-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

vi.mock('./notify', () => ({ notify: () => {} }))

const { db } = await import('./db')
const emailService = await import('./emailService')

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

const hasList = (id: number) => db.data.lists.some((l) => l.id === id)
const members = (id: number) => db.data.list_contacts.filter((lc) => lc.list_id === id)

async function list(emails: string[] = ['jane@acme.test']) {
  const { id } = await emailService.createList(`List ${Math.random()}`)
  await emailService.addContactsToList(id, emails.map((email) => ({ email, attributes: {} }) as any))
  return id
}

function campaignOn(listId: number, fields: Record<string, unknown> = {}) {
  const id = Math.max(0, ...db.data.campaigns.map((c) => c.id)) + 1
  db.data.campaigns.push({ id, name: `Campaign ${id}`, list_id: listId, status: 'draft', ...fields } as any)
  return id
}

describe('deleting a list', () => {
  beforeEach(() => {
    db.data.campaigns = []
    db.data.forms = []
    db.data.surveys = []
  })

  it('removes the list and who is on it, and keeps the contacts', async () => {
    const id = await list()
    await emailService.deleteList(id)
    expect(hasList(id)).toBe(false)
    expect(members(id)).toEqual([])
    expect(db.data.contacts.some((c) => c.email === 'jane@acme.test')).toBe(true)
  })

  it("leaves other lists' members alone", async () => {
    const keep = await list()
    await emailService.deleteList(await list())
    expect(members(keep)).toHaveLength(1)
  })

  it('says so when the list is already gone', async () => {
    await expect(emailService.deleteList(99999)).rejects.toThrow("doesn't exist")
  })

  it("won't delete the default list, which sign-ups go to", async () => {
    await expect(emailService.deleteList(1)).rejects.toThrow('default list')
    expect(hasList(1)).toBe(true)
  })

  it("won't delete the only list, or the sample contacts come back at the next start", async () => {
    const lists = db.data.lists
    db.data.lists = [{ id: 7, name: 'Only', created_at: '' }]
    await expect(emailService.deleteList(7)).rejects.toThrow('only list')
    expect(hasList(7)).toBe(true)
    db.data.lists = lists
  })

  it("won't delete a list a form adds to", async () => {
    const id = await list()
    db.data.forms = [{ id: 'f1', name: 'Newsletter', list_id: id } as any]
    await expect(emailService.deleteList(id)).rejects.toThrow('form "Newsletter"')
    expect(hasList(id)).toBe(true)
    expect(members(id)).toHaveLength(1)
  })

  it("won't delete a list a survey adds to", async () => {
    const id = await list()
    db.data.surveys = [{ id: 's1', name: 'NPS', settings: { listId: id } } as any]
    await expect(emailService.deleteList(id)).rejects.toThrow('survey "NPS"')
    expect(hasList(id)).toBe(true)
  })

  it.each(['draft', 'scheduled', 'sending', 'suspended'])("won't delete a list a %s campaign will read", async (status) => {
    const id = await list()
    const campaign = campaignOn(id, { status })
    await expect(emailService.deleteList(id)).rejects.toThrow(`${status} campaign`)
    expect(hasList(id)).toBe(true)
    expect(db.data.campaigns.find((c) => c.id === campaign)?.list_id).toBe(id)
  })

  it("won't delete a list a sent campaign is still holding guessed addresses for", async () => {
    const id = await list()
    campaignOn(id, { status: 'sent', guess_hold: { status: 'waiting' } })
    await expect(emailService.deleteList(id)).rejects.toThrow('held campaign')
    expect(hasList(id)).toBe(true)
  })

  it('names the first three things using it, then how many more', async () => {
    const id = await list()
    for (let i = 0; i < 5; i++) campaignOn(id)
    await expect(emailService.deleteList(id)).rejects.toThrow(/and 2 more\. Move them/)
  })

  it('still deletes a list only sent campaigns used', async () => {
    const id = await list()
    campaignOn(id, { status: 'sent', guess_hold: { status: 'released' } })
    await emailService.deleteList(id)
    expect(hasList(id)).toBe(false)
  })

  it("can't reach unrelated people when a new list gets the old id", async () => {
    const id = Math.max(...db.data.lists.map((l) => l.id)) + 1
    expect(await list()).toBe(id)
    const sent = campaignOn(id, { status: 'sent' })
    await emailService.deleteList(id)
    // Ids are the highest plus one, so the next list gets it back.
    expect(await list(['someone-else@globex.test'])).toBe(id)
    expect(db.data.campaigns.find((c) => c.id === sent)?.list_id).toBeNull()
  })

  it('comes through a save', async () => {
    const id = await list()
    await emailService.deleteList(id)
    expect(hasList(id)).toBe(false)
    expect(JSON.parse(readFileSync(process.env.DATABASE_PATH!, 'utf8')).lists.some((l: any) => l.id === id)).toBe(false)
  })
})
