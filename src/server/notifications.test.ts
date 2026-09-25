import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// db.ts reads DATABASE_PATH at module load time (not through env.ts), so it
// has to be set before the dynamic import below — a scratch file, so this
// suite never touches the real local_db.json.
const scratchDir = mkdtempSync(join(tmpdir(), 'notifications-test-'))
process.env.DATABASE_PATH = join(scratchDir, 'local_db.json')

const { db } = await import('./db')

beforeEach(() => {
  // The module (and its seed data) loads once for the whole file; each test
  // only needs a clean notifications list, not a whole fresh instance.
  db.clearNotifications()
})

afterAll(() => {
  delete process.env.DATABASE_PATH
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('clearNotifications', () => {
  it('removes every notification when called with no ids', () => {
    db.addNotification('contact_added', 'Alice joined')
    db.addNotification('form_submission', 'New form submission')
    expect(db.getNotifications()).toHaveLength(2)

    db.clearNotifications()

    expect(db.getNotifications()).toHaveLength(0)
    expect(db.getUnreadNotificationCount()).toBe(0)
  })

  it('removes only the given ids, leaving the rest untouched', () => {
    db.addNotification('contact_added', 'Alice joined')
    db.addNotification('form_submission', 'New form submission')
    db.addNotification('campaign_sent', 'Campaign sent')
    const [keep, drop] = db.getNotifications()

    db.clearNotifications([drop.id])

    const remaining = db.getNotifications()
    expect(remaining.map((n) => n.id)).not.toContain(drop.id)
    expect(remaining.map((n) => n.id)).toContain(keep.id)
    expect(remaining).toHaveLength(2)
  })

  it('is a no-op for an id that does not exist', () => {
    db.addNotification('contact_added', 'Alice joined')
    db.clearNotifications(['not-a-real-id'])
    expect(db.getNotifications()).toHaveLength(1)
  })

  it('does not resurrect the read/unread state — clearing is permanent', () => {
    db.addNotification('contact_added', 'Alice joined')
    db.markNotificationsRead()
    db.clearNotifications()
    db.addNotification('contact_added', 'Bob joined')

    // A cleared notification cannot come back; only the new one exists.
    expect(db.getNotifications()).toHaveLength(1)
    expect(db.getUnreadNotificationCount()).toBe(1)
  })

  it('handles clearing when there are no notifications at all', () => {
    expect(() => db.clearNotifications()).not.toThrow()
    expect(db.getNotifications()).toHaveLength(0)
  })
})
