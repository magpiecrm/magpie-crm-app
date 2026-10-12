import { describe, expect, it } from 'vitest'
import { emptyMergeTags, mergeContact, unfilledMergeTags } from './mergeTags'

const jo = { email: 'jo@acme.test', first_name: 'Jo', last_name: 'Smith', company: 'Acme & Sons', custom: { plan: 'Pro' } }
const nameless = { email: 'x@acme.test', first_name: '', last_name: '', company: '' }

describe('mergeContact', () => {
  it('fills in the contact, by either name for a field, escaped for HTML', () => {
    expect(mergeContact('Hi {{ contact.first_name }} {{contact.LASTNAME}} at {{ contact.COMPANY }}', jo, { html: false })).toBe('Hi Jo Smith at Acme & Sons')
    expect(mergeContact('<p>{{ contact.company }} · {{ contact.custom.plan }} · {{ contact.email }}</p>', jo, { html: true })).toBe('<p>Acme &amp; Sons · Pro · jo@acme.test</p>')
  })

  it('uses the fallback for an empty value, however its quote marks were written', () => {
    const ways = [
      '{{ contact.FIRSTNAME | default: "there" }}',
      "{{ contact.FIRSTNAME | default: 'there' }}",
      // As the email builder writes a text block into HTML.
      '{{ contact.FIRSTNAME | default: &quot;there&quot; }}',
      '{{ contact.FIRSTNAME | default: &#34;there&#34; }}',
      '{{ contact.FIRSTNAME | default: &#39;there&#39; }}',
      // Curly quotes, typed or pasted.
      '{{ contact.FIRSTNAME | default: “there” }}',
      '{{ contact.FIRSTNAME | default: &ldquo;there&rdquo; }}',
      // Non-breaking spaces an editor left inside the tag.
      '{{&nbsp;contact.FIRSTNAME&nbsp;|&nbsp;default: &quot;there&quot;&nbsp;}}',
      '{{contact.firstname|default:"there"}}',
    ]
    for (const tag of ways) {
      expect(mergeContact(`Hi ${tag},`, nameless, { html: true }), tag).toBe('Hi there,')
      expect(mergeContact(`Hi ${tag},`, jo, { html: true }), tag).toBe('Hi Jo,')
    }
  })

  it('escapes a fallback once, whether it was written as text or as HTML', () => {
    expect(mergeContact('{{ contact.company | default: &quot;you &amp; yours&quot; }}', nameless, { html: true })).toBe('you &amp; yours')
    expect(mergeContact('{{ contact.company | default: "you & yours" }}', nameless, { html: true })).toBe('you &amp; yours')
    expect(mergeContact('{{ contact.company | default: "you & yours" }}', nameless, { html: false })).toBe('you & yours')
    // An apostrophe inside double quotes is part of the words.
    expect(mergeContact(`{{ contact.first_name | default: "what's up" }}`, nameless, { html: false })).toBe("what's up")
  })

  it('leaves alone what isn’t a contact tag of ours', () => {
    expect(mergeContact('{{ unsubscribe }} {{ contact.job_title }} {{ survey.1 }}', jo, { html: true })).toBe('{{ unsubscribe }} {{ contact.job_title }} {{ survey.1 }}')
  })
})

describe('unfilledMergeTags', () => {
  it('names the contact tags that would go out showing', () => {
    const html = '<p>Hi {{ contact.FIRSTNAME | default: &quot;there&quot; }}, {{ contact.job_title }} at {{ contact.COMPANY }}. {{ contact.first_name | default: there }} {{ unsubscribe }}</p>'
    expect(unfilledMergeTags(html)).toEqual(['{{ contact.job_title }}', '{{ contact.first_name | default: there }}'])
    expect(unfilledMergeTags('Hi {{ contact.first_name }}, {{ contact.custom.plan | default: "free" }} {{ unsubscribe }}')).toEqual([])
    // Asked twice, the same answer: the check keeps no place between calls.
    expect(unfilledMergeTags(html)).toHaveLength(2)
  })
})

describe('emptyMergeTags', () => {
  it('names tags with nothing to show and no fallback', () => {
    expect(emptyMergeTags('{{ contact.first_name }} {{ contact.company | default: &quot;your team&quot; }}', nameless)).toEqual(['first_name'])
  })
})
