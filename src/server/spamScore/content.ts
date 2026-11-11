// What an email says, as spam filters read it: the subject, the words, the
// links and images, and the tracking that goes in at send time. Each rule
// that fires is a finding with its points (POINTS); none of this knows who
// sends it or to whom (sender.ts, recipients.ts).

import type { SpamFinding } from '../../features/spam-score/types'
import { GMAIL_CLIP_BYTES } from '../copilot/lint'
import { htmlToText } from '../providers/plainText'
import { salesyWords, SHOUT_WORDS, triggerPhrases } from './phrases'

export interface ContentInput {
  kind: 'campaign' | 'sequence'
  /** Null: a sequence follow-up in the same thread ("Re: …"), which keeps the first email's subject. */
  subject: string | null
  previewText?: string | null
  /** A campaign's HTML, without the builder's design data. */
  html?: string
  /** A sequence email's text: its body, sign-off and last line. */
  text?: string
  /** A sequence email's own words, without the sign-off and last line `text` adds. */
  body?: string
  /** A sign-off goes on when it's sent, whatever the text says: the AI's own emails in a personalised sequence (render.ts aiSignOff). */
  signOffAdded?: boolean
  /** Most of the people it goes to are cold (found by prospecting, not signed up or replied). */
  cold: boolean
  trackOpens: boolean
  trackClicks: boolean
  /** An unsubscribe link goes out with it. */
  unsubscribe: boolean
}

/** Starting weights; tuned against real results (see the plan's calibration). */
export const POINTS = {
  subjectCaps: 8,
  subjectBangs: 6,
  subjectBang: 3,
  subjectMoney: 4,
  subjectFakeReply: 10,
  subjectLong: 3,
  subjectEmoji: 3,
  subjectPhrase: 6,
  subjectPhraseMax: 15,
  subjectWord: 4,
  subjectWordMax: 8,
  noPreview: 2,
  bodyPhrase: 3,
  bodyPhraseMax: 15,
  bodyWord: 2,
  bodyWordMax: 8,
  bodyCaps: 8,
  imagesOnly: 15,
  imageHeavy: 8,
  littleText: 10,
  noAlt: 2,
  noAltMax: 6,
  placeholderImage: 5,
  clipped: 5,
  activeContent: 15,
  hiddenText: 8,
  noUnsubscribe: 15,
  manyLinksCold: 8,
  manyLinks: 5,
  shortener: 12,
  ipLink: 15,
  maskedLink: 10,
  emptyLink: 3,
  linkDomains: 4,
  longCold: 4,
  newsletterCold: 6,
  impersonalCold: 4,
  noSignoffCold: 5,
  openTrackingCold: 5,
  clickTrackingCold: 5,
}

const LIMITS = { coldLinks: 3, links: 20, linkDomains: 5, subjectLength: 70, coldWords: 200, fewWords: 40, littleText: 5 }

const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly',
  'shorturl.at', 'rb.gy', 'tiny.cc', 'lnkd.in', 't.ly', 's.id', 'bl.ink', 'short.io', 'v.gd',
])
const PLACEHOLDER_IMAGES = /\b(via\.placeholder\.com|placehold\.co|placehold\.it|placekitten\.com|picsum\.photos|dummyimage\.com)\b/i
/** Short forms common in business email, which aren't shouting. */
const ACRONYMS = new Set([
  'CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CRM', 'API', 'B2B', 'B2C', 'ROI', 'SEO', 'GDPR', 'PECR', 'SMS', 'FAQ', 'PDF',
  'KPI', 'ERP', 'HTML', 'URL', 'SMTP', 'DNS', 'SQL', 'AWS', 'LLC', 'LTD', 'PLC', 'USA', 'NHS', 'VAT', 'HMRC', 'SAAS',
])
const MERGE_TAG = /\{\{[^{}]*\}\}/
const MERGE_TAGS = new RegExp(MERGE_TAG.source, 'g')
const PERSONAL_TAG = /\{\{[^{}]*\b(contact\.|first_?name|last_?name|company)\b/i
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi
const LOOKS_LIKE_ADDRESS = /^(https?:\/\/\S+|www\.\S+|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?)$/i
const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(px|pt|em|rem|%)?\s*(;|$)|opacity\s*:\s*0(\.0+)?\s*(;|$)/i

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))?.slice(2).find((v) => v !== undefined)
const decode = (s: string) => htmlToText(s).trim()
const wordsIn = (text: string) => text.replace(URL_RE, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const quoted = (xs: string[]) => xs.slice(0, 3).map((x) => `"${x}"`).join(', ') + (xs.length > 3 ? '…' : '')
const withoutLinks = (text: string) => text.replace(URL_RE, ' ')
const hasText = (s: string) => /[\p{L}\p{N}]/u.test(s)

/** Words in capitals that aren't short forms like CEO, each once: merge tags and links left out. */
function shoutedWords(text: string): string[] {
  const plain = withoutLinks(text).replace(MERGE_TAGS, ' ')
  const caps = plain.match(/(?<![\p{L}\p{N}])\p{Lu}{3,}(?![\p{L}\p{N}])/gu) ?? []
  return [...new Set(caps.filter((w) => !ACRONYMS.has(w)))]
}

/** Three or more words in capitals in a row, "PLEASE READ THIS": shouting a line, not naming firms like HSBC, KPMG. */
function shoutedRuns(text: string): string[] {
  const plain = withoutLinks(text).replace(MERGE_TAGS, ' ')
  return [...new Set(plain.match(/(?<![\p{L}\p{N}])\p{Lu}{2,}(?:[ \t]+\p{Lu}{2,}){2,}(?![\p{L}\p{N}])/gu) ?? [])]
}

const GREETING = /^(hi|hello|hey|dear|morning|afternoon|good (morning|afternoon|evening))\b/i
const CLOSING =
  /^(thanks|thank you|many thanks|thanks again|cheers|best|all the best|regards|kind regards|best regards|warm regards|warmly|sincerely|yours|talk soon|speak soon|take care|ta|thx)\b/i
/** The line a person leaves by, which isn't the sign-off. */
const UNSUBSCRIBE_LINE = /unsubscribe|opt[\s-]?out|manage (your )?(email )?preferences|update (your )?preferences|stop (receiving|getting) (these )?emails|rather not hear|no longer (wish|want) to (receive|hear)/i

/** A line that is someone's name, or their name and company: "Sam", "Sam Jones, Acme", "Sam | Founder, Acme". */
function looksLikeName(line: string): boolean {
  if (line.length > 60 || /[?!:]|https?:/.test(line)) return false
  const words = line.split(/[\s,|·–—-]+/).filter(Boolean)
  return words.length > 0 && words.length <= 6 && words.every((w) => /^[\p{Lu}\p{N}&@]/u.test(w) || /^(at|of|and|the|for)$/i.test(w))
}

/** Whether the email ends by saying who's writing: a sign-off or a name, in its last few lines. */
function signsOff(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => hasText(l) && !UNSUBSCRIBE_LINE.test(l))
  // The first line is the greeting (or the only line), and "Hi" on its own isn't a name.
  return lines.slice(1).slice(-6).some((l) => !GREETING.test(l) && (CLOSING.test(l) || looksLikeName(l)))
}

interface Link {
  href: string
  /** What the reader sees. */
  label: string
}

/** Links a person could click: not the unsubscribe link, a survey link or an email address. */
function linksIn(input: ContentInput, markup: string): Link[] {
  if (input.kind === 'sequence') return [...(input.text ?? '').matchAll(URL_RE)].map((m) => ({ href: m[0], label: m[0] }))
  const links: Link[] = []
  for (const m of markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (attr(m[1], 'href') ?? '').trim()
    if (/\{\{\s*(unsubscribe|survey_link)/i.test(href) || /^(mailto|tel|sms):/i.test(href) || /api\/unsubscribe/i.test(href)) continue
    links.push({ href, label: decode(m[2]) })
  }
  return links
}

/** The host a link goes to, or null for one that isn't a web address yet (a merge tag, `#`, empty). */
function hostOf(href: string): string | null {
  if (!href || href.startsWith('#') || MERGE_TAG.test(href)) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(href) ? href : `https://${href}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

const isIp = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')

/** The websites an email links to, for the blocklist check (sender.ts). */
export function linkHosts(input: ContentInput): string[] {
  const markup = (input.html ?? '').replace(/<!--[\s\S]*?-->/g, '')
  return [...new Set(linksIn(input, markup).map((l) => hostOf(l.href)).filter((h): h is string => h !== null && !isIp(h)))]
}

export function contentFindings(input: ContentInput): SpamFinding[] {
  const out: SpamFinding[] = []
  const add = (code: string, points: number, text: string, fix: string, fixable = true) => out.push({ code, part: 'content', points, fixable, text, fix })
  const isCampaign = input.kind === 'campaign'
  const html = input.html ?? ''
  // Outlook's conditional comments repeat every button for Word: read what other clients show.
  const markup = html.replace(/<!--[\s\S]*?-->/g, '')
  const text = isCampaign ? htmlToText(html) : (input.text ?? '')
  const words = wordsIn(text)

  // --- Subject ---
  const subject = input.subject?.trim() ?? null
  if (subject) {
    const caps = (subject.match(/\b[A-Z][A-Z0-9]{2,}\b/g) ?? []).filter((w) => !ACRONYMS.has(w) && /[A-Z]{3}/.test(w))
    if (caps.length >= 2 || caps.some((w) => w.length >= 5)) {
      add('subject_caps', POINTS.subjectCaps, `The subject shouts in capitals (${quoted(caps)}).`, 'Write the subject in normal sentence case.')
    }
    const bangs = (subject.match(/!/g) ?? []).length
    if (bangs >= 2 || /\?!|!\?/.test(subject)) {
      add('subject_bangs', POINTS.subjectBangs, 'The subject has several exclamation marks.', 'Take them out: a plain subject reads as a person writing.')
    } else if (/!\s*$/.test(subject)) {
      add('subject_bang', POINTS.subjectBang, 'The subject ends with an exclamation mark.', 'End it plainly, or with a question.')
    }
    if (/[$£€¥]\s?\d|\d\s?(%|percent\b)|\b\d+\s?(usd|gbp|eur)\b/i.test(subject)) {
      add('subject_money', POINTS.subjectMoney, 'The subject leads with a price or a discount.', 'Keep prices and percentages for the email itself.')
    }
    if (/^\s*(re|fwd?|fw)\s*:/i.test(subject)) {
      add(
        'subject_fake_reply',
        POINTS.subjectFakeReply,
        `The subject starts with "${subject.split(':')[0]}:" but this is a new email, not a reply. Filters and readers both treat that as a trick.`,
        isCampaign ? 'Remove the "Re:" or "Fwd:".' : 'Remove it, or make this email a reply in the same thread instead of giving it its own subject.',
      )
    }
    if (subject.length > LIMITS.subjectLength) {
      add('subject_long', POINTS.subjectLong, `The subject is ${subject.length} characters; phones cut it off at about 40.`, 'Shorten it to a few words.')
    }
    const emoji = subject.match(/\p{Extended_Pictographic}/gu)?.length ?? 0
    if (emoji >= 2) add('subject_emoji', POINTS.subjectEmoji, `The subject has ${emoji} emoji.`, 'Use one at most, or none.')
    const phrases = triggerPhrases(subject)
    if (phrases.length) {
      add(
        'subject_phrases',
        Math.min(POINTS.subjectPhraseMax, POINTS.subjectPhrase * phrases.length),
        `The subject uses ${phrases.length === 1 ? 'a phrase' : 'phrases'} spam filters look for: ${quoted(phrases)}.`,
        'Say it in your own words.',
      )
    }
    const selling = salesyWords(withoutLinks(subject), phrases)
    if (selling.length) {
      add(
        'subject_words',
        Math.min(POINTS.subjectWordMax, POINTS.subjectWord * selling.length),
        `The subject sells (${quoted(selling)}). Words like that count for more in a subject than anywhere else.`,
        'Make the subject about them or their work, and keep the offer for the email.',
      )
    }
  }
  if (isCampaign && html && !input.previewText?.trim()) {
    add('no_preview', POINTS.noPreview, 'There is no preview text, so inboxes show whatever text comes first.', 'Add a short preview line under the subject.')
  }

  // --- Words ---
  const subjectPhrases = new Set(subject ? triggerPhrases(subject) : [])
  const bodyPhrases = triggerPhrases(text).filter((p) => !subjectPhrases.has(p))
  if (bodyPhrases.length) {
    add(
      'body_phrases',
      Math.min(POINTS.bodyPhraseMax, POINTS.bodyPhrase * bodyPhrases.length),
      `The email uses ${plural(bodyPhrases.length, 'phrase')} spam filters look for: ${quoted(bodyPhrases)}.`,
      'Rewrite those lines in plainer words.',
    )
  }
  // One salesy word is ordinary; a few read as an advert.
  const bodySelling = salesyWords(withoutLinks(text), triggerPhrases(text))
  if (bodySelling.length >= 2) {
    add(
      'body_words',
      Math.min(POINTS.bodyWordMax, POINTS.bodyWord * bodySelling.length),
      `The email uses ${plural(bodySelling.length, 'salesy word')} (${quoted(bodySelling)}). Each is ordinary on its own, but together they read as an advert.`,
      "Keep one, at most, and say plainly what you're offering.",
    )
  }
  const runs = shoutedRuns(text)
  const inRun = (w: string) => runs.some((r) => r.split(/\s+/).includes(w))
  const shouted = [...runs, ...shoutedWords(text).filter((w) => SHOUT_WORDS.has(w) && !inRun(w))]
  if (shouted.length) {
    const them = shouted.length === 1 && !shouted[0].includes(' ') ? 'it' : 'them'
    add(
      'body_caps',
      POINTS.bodyCaps,
      `The email shouts in capitals (${quoted(shouted)}), which is what spam looks like.`,
      isCampaign ? `Write ${them} in normal case. Bold a word if it really needs it.` : `Write ${them} in normal case.`,
    )
  }
  // A sequence email that starts a conversation with next to nothing in it; a follow-up in its thread can be short.
  const ownWords = wordsIn(input.body ?? text)
  if (!isCampaign && input.subject !== null && ownWords < LIMITS.littleText) {
    add(
      'little_text',
      POINTS.littleText,
      ownWords ? `The email says only ${plural(ownWords, 'word')}, besides its sign-off and last line.` : 'The email has no text yet.',
      'Write the message itself: who you are, why them, and one question.',
    )
  }

  // --- Images and markup (campaigns) ---
  if (isCampaign && html) {
    const images = [...markup.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])
    if (images.length && words < LIMITS.fewWords) {
      add('images_only', POINTS.imagesOnly, `The email is mostly images (${plural(images.length, 'image')}, ${plural(words, 'word')}). Filters can't read images, and spam often hides in them.`, 'Put the message in text, with images only to support it.')
    } else if (images.length >= 3 && words < images.length * 25) {
      add('image_heavy', POINTS.imageHeavy, `The email has ${images.length} images and only ${words} words.`, 'Add more text, or use fewer images.')
    } else if (!images.length && words < LIMITS.littleText) {
      // A blank design, or a lone link: filters have nothing to judge it by, and people nothing to read.
      add('little_text', POINTS.littleText, words ? `The email has only ${plural(words, 'word')} of text.` : 'The email has no text yet.', 'Write the message itself in the design.')
    }
    const noAlt = images.filter((tag) => !attr(tag, 'alt')?.trim()).length
    if (noAlt) {
      add('no_alt', Math.min(POINTS.noAltMax, POINTS.noAlt * noAlt), `${plural(noAlt, 'image has', 'images have')} no alt text, which is what people see while images are blocked.`, 'Describe each image in its alt text.')
    }
    if (images.some((tag) => PLACEHOLDER_IMAGES.test(attr(tag, 'src') ?? ''))) {
      add('placeholder_image', POINTS.placeholderImage, 'The email still has placeholder images from a template.', 'Replace them with your own images, or remove them.')
    }
    const bytes = new TextEncoder().encode(html).length
    if (bytes > GMAIL_CLIP_BYTES) {
      add('clipped', POINTS.clipped, `The email is ${Math.round(bytes / 1024)} KB; Gmail cuts off anything over 102 KB, unsubscribe link included.`, 'Remove blocks or large raw HTML.')
    }
    const active = markup.match(/<(script|iframe|form|embed|object)\b/i)
    if (active) {
      add('active_content', POINTS.activeContent, `The email contains a <${active[1].toLowerCase()}> tag, which mail clients block and filters treat as dangerous.`, 'Remove it: link to a page instead.')
    }
    const hidden = [...markup.matchAll(/<(div|span|p|td|font|table|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].some(
      ([, , attrs, inner]) => HIDDEN_STYLE.test(attr(attrs, 'style') ?? '') && /[\p{L}\p{N}]/u.test(decode(inner)),
    )
    if (hidden) add('hidden_text', POINTS.hiddenText, 'Part of the email is hidden text, an old spam trick filters look for.', 'Remove the hidden text from the raw HTML block.')
  }
  if (!input.unsubscribe) {
    add('no_unsubscribe', POINTS.noUnsubscribe, "There's no unsubscribe link. Gmail and Yahoo require one from bulk senders, and people who can't leave mark it as spam.", 'Turn the unsubscribe link back on.')
  }

  // --- Links ---
  const links = linksIn(input, markup)
  const hosts = links.map((l) => hostOf(l.href))
  const webLinks = links.filter((l, i) => hosts[i] !== null || MERGE_TAG.test(l.href))
  if (input.cold && webLinks.length > LIMITS.coldLinks) {
    add('many_links_cold', POINTS.manyLinksCold, `This cold email has ${webLinks.length} links. A first email to someone who doesn't know you does best with one, or none.`, 'Keep the one link that matters, or none: ask a question instead.')
  } else if (!input.cold && webLinks.length > LIMITS.links) {
    add('many_links', POINTS.manyLinks, `The email has ${webLinks.length} links.`, 'Cut it down to the ones people will use.')
  }
  const shortened = [...new Set(hosts.filter((h): h is string => h !== null && SHORTENERS.has(h)))]
  if (shortened.length) {
    add('shortener', POINTS.shortener, `It uses a link shortener (${shortened.join(', ')}), which spammers use to hide where links go.`, 'Link to the full address instead.')
  }
  if (hosts.some((h) => h !== null && isIp(h))) {
    add('ip_link', POINTS.ipLink, 'A link goes to a bare IP address instead of a website name.', 'Link to the site by its name.')
  }
  const masked = links.filter((l, i) => {
    if (!LOOKS_LIKE_ADDRESS.test(l.label)) return false
    // Click tracking sends every link through the app first, so a visible address never matches where it goes.
    if (isCampaign || input.trackClicks) return true
    const shown = hostOf(l.label)
    return shown !== null && hosts[i] !== null && shown !== hosts[i]
  })
  if (masked.length) {
    add(
      'masked_link',
      POINTS.maskedLink,
      `${plural(masked.length, 'link shows', 'links show')} a web address but ${masked.length === 1 ? 'goes' : 'go'} somewhere else${isCampaign || input.trackClicks ? ' (through click tracking)' : ''}, which looks like phishing.`,
      isCampaign || !input.trackClicks ? 'Use a few words as the link text instead of the address.' : 'Turn off click tracking in the sequence settings.',
    )
  }
  const empty = links.filter((l) => !l.href || l.href === '#').length
  if (empty) add('empty_link', POINTS.emptyLink, `${plural(empty, 'link goes', 'links go')} nowhere (#).`, 'Give each button and link a real address, or remove it.')
  const domains = new Set(hosts.filter((h): h is string => h !== null))
  if (domains.size >= LIMITS.linkDomains) {
    add('link_domains', POINTS.linkDomains, `The links go to ${domains.size} different websites.`, 'Link to fewer sites, ideally only your own.')
  }

  // --- Cold email ---
  if (input.cold) {
    if (words > LIMITS.coldWords) {
      add('long_cold', POINTS.longCold, `This cold email is about ${words} words. Short first emails get read and replied to.`, 'Cut it to under 150 words: who you are, why them, one question.')
    }
    if (isCampaign && html) {
      const images = (markup.match(/<img\b/gi) ?? []).length
      const buttons = (html.match(/<v:roundrect\b/gi) ?? []).length
      if (images >= 2 || buttons >= 1) {
        add('newsletter_cold', POINTS.newsletterCold, 'This cold email is designed like a newsletter (images and buttons). To filters and people alike that reads as marketing.', 'Send cold email as plain text: a short note from one person to another.')
      }
    }
    if (!PERSONAL_TAG.test(`${subject ?? ''}\n${isCampaign ? html : text}`)) {
      add('impersonal_cold', POINTS.impersonalCold, 'This cold email is the same for everyone: no name or company in it.', 'Use their first name or company, e.g. {{ contact.first_name }}.')
    }
    // A follow-up in its thread sits under the email that said who's writing.
    if (input.subject !== null && !input.signOffAdded && words && !signsOff(text)) {
      add(
        'no_signoff_cold',
        POINTS.noSignoffCold,
        "It doesn't say who's writing: there's no sign-off or name at the end. A cold email from nobody in particular reads as bulk mail.",
        isCampaign ? "End with your name, and your company if they won't know it." : 'Add your name and company as the sign-off in the sequence settings.',
      )
    }
    if (input.trackOpens) {
      add('open_tracking_cold', POINTS.openTrackingCold, 'Open tracking adds a hidden image, which marks cold email as bulk mail.', isCampaign ? 'Turn off "Track opens" in the design settings.' : 'Turn off open tracking in the sequence settings.')
    }
    if (webLinks.length) {
      if (!isCampaign && input.trackClicks) {
        add('click_tracking_cold', POINTS.clickTrackingCold, 'Click tracking sends every link through a redirect, which filters mark down in cold email.', 'Turn off click tracking in the sequence settings.')
      } else if (isCampaign) {
        add('click_tracking_note', 0, "Campaign links go through the app's click tracking, which filters can mark down in cold email.", 'Fewer links means less of it; a sequence can send without tracking.', false)
      }
    }
  }
  return out
}
