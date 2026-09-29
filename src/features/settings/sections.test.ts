import { describe, expect, it } from 'vitest'
import { parseSettingsSection, SETTINGS_SECTIONS } from './sections'

describe('settings pages', () => {
  it('opens Plan and billing by link, in the Workspace group', () => {
    expect(parseSettingsSection('billing')).toBe('billing')
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'billing')?.group).toBe('Workspace')
    expect(parseSettingsSection('users')).toBe('team')
    expect(parseSettingsSection('nope')).toBeUndefined()
  })
})
