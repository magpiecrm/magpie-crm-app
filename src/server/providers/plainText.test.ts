import { describe, expect, it } from 'vitest'
import { htmlToText } from './plainText'

describe('plain-text version of an email', () => {
  it('keeps the words, paragraphs, lists and link addresses, and drops styles and markup', () => {
    const html = `<html><head><title>x</title><style>p{color:red}</style></head><body>
      <h1>Hello&nbsp;Jo</h1><p>Thanks for your time &amp; the <b>call</b>.<br>Talk soon.</p>
      <ul><li>One</li><li>Two</li></ul>
      <p><a href="https://acme.com/demo?a=1&amp;b=2">Book a demo</a> or <a href="https://acme.com">https://acme.com</a></p>
      <p><a href="mailto:jo@acme.com">Email me</a></p>
      <table><tr><td>Left</td><td>Right</td></tr></table>
      <img src="https://t.example/open.gif" alt=""><!-- tracking -->
      <p>&#8220;Quoted&#8221; &copy; 2026</p></body></html>`
    expect(htmlToText(html)).toBe(
      'Hello Jo\n\nThanks for your time & the call.\nTalk soon.\n\n- One\n- Two\n\nBook a demo (https://acme.com/demo?a=1&b=2) or https://acme.com\n\nEmail me\n\nLeft Right\n\n“Quoted” © 2026',
    )
  })

  it('handles plain text and empty HTML', () => {
    expect(htmlToText('Hi')).toBe('Hi')
    expect(htmlToText('')).toBe('')
  })
})
