import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// How the data file is read at start: a missing or empty one starts fresh, an
// older one gains what it lacks, and one that can't be read stops the app
// rather than being written over.

const scratchDir = mkdtempSync(join(tmpdir(), 'db-load-test-'))
let file = ''
let n = 0

async function start() {
  vi.resetModules()
  return (await import('./db')).db
}

beforeEach(() => {
  file = join(scratchDir, `db-${++n}.json`)
  process.env.DATABASE_PATH = file
})

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('reading the data file at start', () => {
  it('starts fresh when there is no file, or an empty one', async () => {
    // A fresh one comes with its sample contacts and nothing else.
    expect((await start()).data.sessions).toEqual([])
    writeFileSync(file, '  \n')
    const db = await start()
    expect(db.data.sessions).toEqual([])
    expect(db.data.campaign_recipients).toEqual([])
  })

  it('gives an older file the collections it lacks, and keeps what it holds', async () => {
    writeFileSync(file, JSON.stringify({ lists: [{ id: 1, name: 'Customers', created_at: '2026-01-01' }], contacts: [], senders: [], campaigns: [] }))
    const db = await start()
    expect(db.data.lists).toHaveLength(1)
    expect(db.data.sessions).toEqual([])
    expect(db.data.email_templates).toEqual([])
  })

  it("stops on a file it can't read, leaving it as it is with a copy beside it", async () => {
    const broken = '{"contacts":[{"email":"kept@example.test"'
    writeFileSync(file, broken)
    await expect(start()).rejects.toThrow(/can't be read/)
    expect(readFileSync(file, 'utf8')).toBe(broken)
    const copies = readdirSync(scratchDir).filter((name) => name.startsWith(`db-${n}.json.corrupt-`))
    expect(copies).toHaveLength(1)
    expect(readFileSync(join(scratchDir, copies[0]), 'utf8')).toBe(broken)
    // Starting again doesn't pile up copies.
    await expect(start()).rejects.toThrow(/can't be read/)
    expect(readdirSync(scratchDir).filter((name) => name.startsWith(`db-${n}.json.corrupt-`))).toHaveLength(1)
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })
})
