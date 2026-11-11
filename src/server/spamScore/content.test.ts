import { describe, expect, it } from 'vitest'
import { contentFindings, linkHosts, type ContentInput } from './content'
import { triggerPhrases } from './phrases'

const campaign = (over: Partial<ContentInput> = {}): ContentInput => ({
  kind: 'campaign',
  subject: 'Quick question about your hiring',
  previewText: 'A short note',
  html: '<p>Hi {{ contact.first_name }}, saw you are hiring engineers. Worth a chat next week?</p><p><a href="{{ unsubscribe }}">Unsubscribe</a></p>',
  cold: false,
  trackOpens: false,
  trackClicks: true,
  unsubscribe: true,
  ...over,
})

const sequence = (over: Partial<ContentInput> = {}): ContentInput => ({
  kind: 'sequence',
  subject: 'Quick question',
  text: 'Hi {{ contact.first_name }},\n\nSaw you are hiring. Worth a chat?\n\nJo\n\nNot interested? {{ unsubscribe }}',
  cold: true,
  trackOpens: false,
  trackClicks: false,
  unsubscribe: true,
  ...over,
})

const codes = (input: ContentInput) => contentFindings(input).map((f) => f.code)
const finding = (input: ContentInput, code: string) => contentFindings(input).find((f) => f.code === code)

describe('a plain, personal email', () => {
  it('has nothing against it', () => {
    expect(contentFindings(campaign())).toEqual([])
    expect(contentFindings(sequence())).toEqual([])
  })
})

describe('the subject', () => {
  it('marks down shouting, but not ordinary acronyms', () => {
    expect(codes(campaign({ subject: 'FREE TRIAL for your team' }))).toContain('subject_caps')
    expect(codes(campaign({ subject: 'URGENT update' }))).toContain('subject_caps')
    expect(codes(campaign({ subject: 'Your CRM and GDPR' }))).not.toContain('subject_caps')
  })

  it('marks down exclamation marks, more for several', () => {
    expect(codes(campaign({ subject: 'Big news!!' }))).toContain('subject_bangs')
    expect(codes(campaign({ subject: 'Really?!' }))).toContain('subject_bangs')
    expect(codes(campaign({ subject: 'Big news!' }))).toEqual(['subject_bang'])
  })

  it('catches prices, fake replies, length, emoji and trigger phrases', () => {
    expect(codes(campaign({ subject: 'Save 50% this week' }))).toContain('subject_money')
    expect(codes(campaign({ subject: 'Only £9 a month' }))).toContain('subject_money')
    expect(codes(campaign({ subject: 'Re: our call' }))).toContain('subject_fake_reply')
    expect(codes(campaign({ subject: 'x'.repeat(71) }))).toContain('subject_long')
    expect(codes(campaign({ subject: 'Hello 🎉🚀' }))).toContain('subject_emoji')
    expect(finding(campaign({ subject: 'Act now: limited time, risk-free' }), 'subject_phrases')?.points).toBe(15)
  })

  it("leaves a sequence follow-up's thread subject alone", () => {
    expect(contentFindings(sequence({ subject: null }))).toEqual([])
  })

  it('asks for preview text on campaigns only', () => {
    expect(codes(campaign({ previewText: '' }))).toEqual(['no_preview'])
    expect(codes(sequence())).not.toContain('no_preview')
  })
})

describe('the body', () => {
  it('finds trigger phrases once, not twice when the subject has them too', () => {
    const f = finding(campaign({ subject: 'Click here', html: '<p>Click here for a risk-free trial. Act now.</p>' }), 'body_phrases')
    expect(f?.text).toMatch(/"act now", "risk-free"/)
    expect(f?.text).not.toMatch(/click here/)
  })

  it('marks down an email that is mostly images', () => {
    expect(codes(campaign({ html: '<img src="https://a.test/banner.png" alt="Sale"><p>Shop now</p>' }))).toContain('images_only')
  })

  it('marks down an email with almost no text', () => {
    expect(finding(campaign({ html: '<html><head><title>Email Newsletter</title></head><body></body></html>' }), 'little_text')?.text).toBe('The email has no text yet.')
    expect(codes(campaign({ html: '<p><a href="https://a.test/offer">See the offer</a></p>' }))).toContain('little_text')
    expect(codes(campaign())).not.toContain('little_text')
  })

  it('counts images without alt text, and placeholder images', () => {
    const f = contentFindings(campaign({ html: `<p>${'word '.repeat(80)}</p><img src="https://via.placeholder.com/600x300"><img src="x.png" alt="">` }))
    expect(f.find((x) => x.code === 'no_alt')?.points).toBe(4)
    expect(f.map((x) => x.code)).toContain('placeholder_image')
  })

  it("flags active content and hidden text, but not Outlook's hidden button copy", () => {
    expect(codes(campaign({ html: '<p>Hi</p><script>x()</script>' }))).toContain('active_content')
    expect(codes(campaign({ html: '<p>Hi there friend</p><div style="display:none">cheap pills</div>' }))).toContain('hidden_text')
    expect(codes(campaign({ html: '<p>Hi there</p><a href="https://a.test" style="display: inline-block; mso-hide: all;">Go</a>' }))).not.toContain('hidden_text')
  })

  it('flags a missing unsubscribe link', () => {
    expect(codes(campaign({ unsubscribe: false }))).toContain('no_unsubscribe')
  })

  it('flags an email past Gmail’s clipping size', () => {
    expect(codes(campaign({ html: `<p>${'a'.repeat(110_000)}</p>` }))).toContain('clipped')
  })
})

describe('links', () => {
  it('allows a few links in cold email and many in opt-in', () => {
    const links = (n: number) => Array.from({ length: n }, (_, i) => `<a href="https://site.test/${i}">page ${i}</a>`).join(' ')
    expect(codes(campaign({ cold: true, html: `<p>Hi {{ contact.first_name }}</p>${links(3)}` }))).not.toContain('many_links_cold')
    expect(codes(campaign({ cold: true, html: `<p>Hi {{ contact.first_name }}</p>${links(4)}` }))).toContain('many_links_cold')
    expect(codes(campaign({ html: `<p>Hi</p>${links(20)}` }))).not.toContain('many_links')
    expect(codes(campaign({ html: `<p>Hi</p>${links(21)}` }))).toContain('many_links')
  })

  it('leaves the unsubscribe and email links out of the count', () => {
    expect(linkHosts(campaign({ html: '<a href="{{ unsubscribe }}">u</a><a href="mailto:jo@a.test">m</a><a href="https://www.site.test/x">s</a>' }))).toEqual(['site.test'])
  })

  it('catches shorteners, bare IPs, empty links and many sites', () => {
    expect(codes(campaign({ html: '<p>Hi</p><a href="https://bit.ly/abc">read</a>' }))).toContain('shortener')
    expect(codes(campaign({ html: '<p>Hi</p><a href="http://192.168.1.1/x">read</a>' }))).toContain('ip_link')
    expect(codes(campaign({ html: '<p>Hi</p><a href="#">read</a>' }))).toContain('empty_link')
    const sites = ['a', 'b', 'c', 'd', 'e'].map((d) => `<a href="https://${d}.test">${d}</a>`).join('')
    expect(codes(campaign({ html: `<p>Hi</p>${sites}` }))).toContain('link_domains')
  })

  it('flags a visible web address in a campaign, which click tracking redirects', () => {
    const f = finding(campaign({ html: '<p>Hi</p><a href="https://acme.test">acme.test</a>' }), 'masked_link')
    expect(f?.text).toMatch(/through click tracking/)
    expect(f?.fix).toMatch(/words as the link text/)
    expect(codes(campaign({ html: '<p>Hi</p><a href="https://acme.test">Our site</a>' }))).not.toContain('masked_link')
  })

  it('flags sequence links only when click tracking redirects them', () => {
    const text = 'Hi {{ contact.first_name }}, see https://acme.test/case-study\n\n{{ unsubscribe }}'
    expect(codes(sequence({ text }))).not.toContain('masked_link')
    expect(finding(sequence({ text, trackClicks: true }), 'masked_link')?.fix).toMatch(/Turn off click tracking/)
  })

  it('counts each button once, not again in its Outlook copy', () => {
    const button = '<!--[if mso]><v:roundrect href="https://a.test/x"></v:roundrect><![endif]--><!--[if !mso]><!--><a href="https://a.test/x">Go</a><!--<![endif]-->'
    expect(linkHosts(campaign({ html: button }))).toEqual(['a.test'])
    expect(codes(campaign({ cold: true, html: `<p>Hi {{ contact.first_name }}</p>${button.repeat(3)}` }))).not.toContain('many_links_cold')
  })
})

describe('cold email', () => {
  it('is held to plainer rules', () => {
    const html = '<p>Hello</p><img src="a.png" alt="a"><img src="b.png" alt="b"><p>' + 'word '.repeat(220) + '</p>'
    const found = codes(campaign({ cold: true, trackOpens: true, html }))
    expect(found).toEqual(expect.arrayContaining(['long_cold', 'newsletter_cold', 'impersonal_cold', 'open_tracking_cold']))
    expect(codes(campaign({ cold: false, trackOpens: true, html }))).not.toContain('open_tracking_cold')
  })

  it("notes campaign click tracking without counting it, since it can't be switched off", () => {
    const f = finding(campaign({ cold: true, html: '<p>Hi {{ contact.first_name }}</p><a href="https://a.test">Our site</a>' }), 'click_tracking_note')
    expect(f).toMatchObject({ points: 0, fixable: false })
  })

  it('counts sequence click tracking, which can be', () => {
    const text = 'Hi {{ contact.first_name }}, more at https://acme.test\n\n{{ unsubscribe }}'
    expect(finding(sequence({ text, trackClicks: true }), 'click_tracking_cold')?.points).toBeGreaterThan(0)
  })
})

describe('selling', () => {
  const points = (input: ContentInput) => contentFindings(input).reduce((n, f) => n + f.points, 0)

  it('marks down a pushy email that once scored as nothing much', () => {
    const pushy = sequence({ subject: 'Free offer', text: 'Hi\nGet our product for free NOW\n\nNot interested? {{ unsubscribe }}' })
    expect(codes(pushy).sort()).toEqual(['body_caps', 'body_phrases', 'impersonal_cold', 'no_signoff_cold', 'subject_phrases'])
    expect(points(pushy)).toBe(26)
  })

  it('counts salesy words in the subject, but not again inside a phrase', () => {
    expect(finding(campaign({ subject: 'A discount on your hiring' }), 'subject_words')?.points).toBe(4)
    expect(finding(campaign({ subject: 'Cheap bonus deal' }), 'subject_words')?.points).toBe(8)
    expect(codes(campaign({ subject: 'Special offer for your team' }))).toEqual(['subject_phrases'])
    expect(codes(campaign({ subject: 'Your hiring plans' }))).not.toContain('subject_words')
  })

  it('counts salesy words in the email only once there are a few', () => {
    const html = (words: string) => `<p>Hi {{ contact.first_name }}, ${words} for your team. Worth a chat?</p>`
    expect(codes(campaign({ html: html('we can save you time') }))).not.toContain('body_words')
    expect(finding(campaign({ html: html('a discount and a bonus') }), 'body_words')?.points).toBe(4)
    expect(finding(campaign({ html: html('a cheap, exclusive bonus deal at a discount') }), 'body_words')?.points).toBe(8)
    // A word and its plural are one: a CRM's emails talk about deals.
    expect(codes(campaign({ html: html('a deal desk that closes deals') }))).not.toContain('body_words')
    // "free" is counted in the phrase, so only "offer" is left: one word.
    expect(codes(campaign({ html: html('a free trial and an offer') }))).not.toContain('body_words')
  })

  it("doesn't count a company's name, or words in a link", () => {
    expect(codes(campaign({ html: '<p>Hi {{ contact.first_name }}, a discount for you.</p><p>Acme Widgets Limited</p>' }))).not.toContain('body_words')
    expect(codes(sequence({ text: 'Hi {{ contact.first_name }}, a discount: https://acme.test/free-deal\n\nJo\n\n{{ unsubscribe }}' }))).not.toContain('body_words')
  })
})

describe('shouting in the email', () => {
  it('catches a salesy word in capitals, or a line of them', () => {
    expect(finding(sequence({ text: 'Hi {{ contact.first_name }}, reply NOW.\n\nJo\n\n{{ unsubscribe }}' }), 'body_caps')?.text).toMatch(/"NOW"/)
    expect(finding(campaign({ html: '<p>PLEASE READ THIS before Friday, {{ contact.first_name }}.</p>' }), 'body_caps')?.fix).toMatch(/Bold a word/)
  })

  it("leaves short forms, firms' names, merge tags and links alone", () => {
    const text = 'Hi {{ contact.FIRSTNAME }}, we audit for HSBC and KPMG, CEO to CTO: https://ACME.TEST/NOW\n\nJo\n\n{{ unsubscribe }}'
    expect(codes(sequence({ text }))).not.toContain('body_caps')
  })
})

describe('next to no text', () => {
  it('marks down a first email with next to nothing in it, but not a short follow-up', () => {
    const short = { body: 'Hi there', text: 'Hi there\n\nJo Smith\nFounder, Acme\n\nNot interested? {{ unsubscribe }}' }
    expect(finding(sequence(short), 'little_text')?.text).toBe('The email says only 2 words, besides its sign-off and last line.')
    expect(codes(sequence({ ...short, subject: null }))).not.toContain('little_text')
    expect(codes(sequence())).not.toContain('little_text')
  })
})

describe('who is writing', () => {
  const ending = (end: string) => sequence({ text: `Hi {{ contact.first_name }},\n\nSaw you are hiring. Worth a chat?${end}\n\nNot interested? {{ unsubscribe }} and I won't email you again.` })

  it('asks a cold email to sign off', () => {
    expect(finding(ending(''), 'no_signoff_cold')?.fix).toMatch(/sign-off in the sequence settings/)
    expect(finding(campaign({ cold: true }), 'no_signoff_cold')?.fix).toMatch(/End with your name/)
  })

  it('takes a closing or a name', () => {
    expect(codes(ending('\n\nThanks,'))).not.toContain('no_signoff_cold')
    expect(codes(ending('\n\nJo Smith\nFounder, Acme'))).not.toContain('no_signoff_cold')
    expect(codes(ending('\n\n— Sam | Head of Sales, Acme'))).not.toContain('no_signoff_cold')
  })

  it("doesn't ask a follow-up in its thread, an AI-written email, or opt-in email", () => {
    expect(codes(sequence({ subject: null, text: 'Any thoughts?\n\n{{ unsubscribe }}' }))).not.toContain('no_signoff_cold')
    expect(codes({ ...ending(''), signOffAdded: true })).not.toContain('no_signoff_cold')
    expect(codes({ ...ending(''), cold: false })).not.toContain('no_signoff_cold')
  })
})

describe('trigger phrases', () => {
  it('match whole phrases, with either apostrophe', () => {
    expect(triggerPhrases('This isn’t spam, honest')).toEqual(["this isn't spam"])
    expect(triggerPhrases('Our winners list')).toEqual([])
    expect(triggerPhrases('We have a free plan')).toEqual([])
    expect(triggerPhrases('Start a free trial for free')).toEqual(['for free', 'free trial'])
  })
})
