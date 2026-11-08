import { describe, expect, it } from 'vitest'
import { snippet, splitQuoted } from './quote'

// Telling what someone wrote from the earlier emails their reply quotes.

describe('splitting off quoted text', () => {
  it('cuts at Gmail and Apple Mail\'s "On … wrote:", even wrapped onto two lines', () => {
    const gmail = 'Sounds good, Thursday works.\n\nAva\n\nOn Tue, 4 Nov 2026 at 09:40, Jo Smith <jo@acme.test> wrote:\n> Hi Ava,\n> Quick question'
    expect(splitQuoted(gmail)).toEqual({ body: 'Sounds good, Thursday works.\n\nAva', quoted: 'On Tue, 4 Nov 2026 at 09:40, Jo Smith <jo@acme.test> wrote:\n> Hi Ava,\n> Quick question' })
    const wrapped = 'Yes please.\n\nOn Tue, 4 Nov 2026 at 09:40, Jo Smith <\njo@acme.test> wrote:\n> Hi'
    expect(splitQuoted(wrapped).body).toBe('Yes please.')
    expect(splitQuoted('Merci !\n\nLe mar. 4 nov. 2026 à 09:40, Jo <jo@acme.test> a écrit :\n> Bonjour').body).toBe('Merci !')
    expect(splitQuoted('Danke.\n\nAm Di., 4. Nov. 2026 um 09:40 Uhr schrieb Jo <jo@acme.test>:\n> Hallo').body).toBe('Danke.')
  })

  it('cuts at Zoho Mail\'s "---- On … wrote ----"', () => {
    const zoho = 'Hi this sounds interesting\n\nJo Smith\n\n---- On Sun, 08 Nov 2026 12:52:34 +0000 Pele <pele@acme.test> wrote ----\n\nHi,\n\nFilling a beta waitlist…'
    expect(splitQuoted(zoho)).toEqual({ body: 'Hi this sounds interesting\n\nJo Smith', quoted: '---- On Sun, 08 Nov 2026 12:52:34 +0000 Pele <pele@acme.test> wrote ----\n\nHi,\n\nFilling a beta waitlist…' })
  })

  it("cuts at Outlook's header block and its rule, and at Original Message", () => {
    const outlook = 'Happy to talk.\n\n________________________________\nFrom: Jo Smith <jo@acme.test>\nSent: 04 November 2026 09:40\nTo: Ava Stone\nSubject: Quick question\n\nHi Ava'
    expect(splitQuoted(outlook).body).toBe('Happy to talk.')
    expect(splitQuoted(outlook).quoted).toMatch(/^_{10,}\nFrom: Jo Smith/)
    expect(splitQuoted('Not now, thanks.\n\n-----Original Message-----\nFrom: Jo').body).toBe('Not now, thanks.')
    // "From:" in what they wrote, with no Sent: under it, isn't a quote.
    expect(splitQuoted('From: the team at Larkspur, thanks!').quoted).toBe('')
  })

  it('takes a closing run of ">" lines without an introduction, but not quoting in the middle', () => {
    expect(splitQuoted('Sure.\n\n> Quick question\n> Jo')).toEqual({ body: 'Sure.', quoted: '> Quick question\n> Jo' })
    const inline = '> Do you use a CRM?\nYes, a spreadsheet.\n> How many people?\nFour.'
    expect(splitQuoted(inline)).toEqual({ body: inline, quoted: '' })
  })

  it("shows everything when there's nothing new (a forward), and leaves plain replies alone", () => {
    expect(splitQuoted('On Tue, Jo wrote:\n> Hi')).toEqual({ body: 'On Tue, Jo wrote:\n> Hi', quoted: '' })
    expect(splitQuoted('  Thanks!  \n')).toEqual({ body: 'Thanks!', quoted: '' })
  })

  it('makes a one-line snippet of what they wrote', () => {
    expect(snippet('Sounds good,\nThursday works.\n\nOn Tue, Jo wrote:\n> Hi')).toBe('Sounds good, Thursday works.')
    expect(snippet('x'.repeat(200), 20)).toBe(`${'x'.repeat(19)}…`)
  })
})
