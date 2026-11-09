/**
 * Starter templates.
 *
 * The first newsletter and e-commerce layouts were modelled on the MySigMail
 * HTML email templates (https://github.com/mysigmail/html-email-templates,
 * MIT, (c) Anton Reshetov) and rebuilt from scratch in this builder's block
 * model — no markup or CSS is copied.
 *
 * They share one house style (6px button radius, #6b7280 for small print,
 * images cropped to one shape per row, sans throughout but for the editorial
 * newsletter's serif) and each has a sample brand of its own: a mark and a
 * name in its accent colour, which it also uses for its eyebrow and main
 * button, with secondary links outlined or as text. So the set reads as a family without every one looking the same.
 * A starter with its own footer block carries the unsubscribe link there and
 * hides the appended legal line (`footerText: ''`), so there is only ever one.
 *
 * Every brand, name and image is a placeholder the user is expected to swap
 * for their own. The photos are public Unsplash images, each used once, none
 * showing another company's brand.
 */
import type { EmailBlock, GlobalStyle } from '../types'

/** An Unsplash photo cropped to `w`×`h`, so every image in a row has the same shape. */
const img = (id: string, w: number, h: number) => `https://images.unsplash.com/${id}?w=${w}&h=${h}&auto=format&fit=crop`

/** Shown in this order wherever starters are grouped. */
export const STARTER_CATEGORIES = ['Outreach', 'Newsletter', 'Announcement', 'E-commerce', 'Transactional'] as const
export type StarterCategory = (typeof STARTER_CATEGORIES)[number]

export interface StarterTemplate {
  id: string
  name: string
  description: string
  category: StarterCategory
  /** Partial override merged onto the current global style when applied. */
  globalStyle: Partial<GlobalStyle>
  /** Built fresh per call so ids are unique and blocks are never shared by reference. */
  build: () => EmailBlock[]
}

let seq = 0
const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`

const INK = '#111827'
const BODY = '#374151'
const MUTED = '#6b7280'
const SERIF = "Georgia, 'Times New Roman', Times, serif"
const MONO = "'Courier New', Courier, monospace"

/** The house style every starter starts from. */
const HOUSE: Partial<GlobalStyle> = {
  canvasBgColor: '#f4f4f5',
  bodyBgColor: '#ffffff',
  buttonBgColor: '#18181b',
  buttonTextColor: '#ffffff',
  buttonRadius: 6,
  linkColor: '#18181b',
  lineHeight: 1.6,
  cardMode: false,
  paddingX: 40,
  paddingY: 40,
  footerText: '',
}

/** A sample brand: a geometric mark and a name, set as the logo in the accent colour. */
const logo = (mark: string, align: 'left' | 'center', color: string, style: EmailBlock['style'] = {}): EmailBlock => ({
  id: id('b'),
  type: 'logo',
  content: mark,
  align,
  style: { fontSize: 19, color, paddingTop: 0, paddingBottom: 28, ...style },
})

const footerLinks = () => [
  { id: id('fl'), label: 'Unsubscribe', url: '{{ unsubscribe }}' },
  { id: id('fl'), label: 'Privacy', url: '#' },
  { id: id('fl'), label: 'Contact us', url: '#' },
]

const footer = (company: string, reason: string, style: EmailBlock['style'] = {}): EmailBlock => ({
  id: id('b'),
  type: 'footer',
  content: `${company} Ltd · 123 Example Street, London EC1A 1BB\n${reason}`,
  links: footerLinks(),
  style: { color: MUTED, paddingTop: 32, ...style },
})

const eyebrow = (content: string, color: string, style: EmailBlock['style'] = {}): EmailBlock => ({
  id: id('b'),
  type: 'text',
  content,
  style: { fontSize: 13, fontWeight: 'bold', color, paddingBottom: 8, ...style },
})

const subscribed = (company: string) => `You're receiving this because you subscribed to updates from ${company}.`
const customer = (company: string) => `You're receiving this because you have an account with ${company}.`

/** A digest story's Read more: outlined, so the email's own button is the one main action. */
const STORY: EmailBlock['style'] = { paddingBottom: 0, btnVariant: 'outline', btnBgColor: '#1d4ed8' }

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'plain-email',
    name: 'Plain email',
    description: 'Reads like a note from a person: no images, one question.',
    category: 'Outreach',
    globalStyle: {
      ...HOUSE,
      canvasBgColor: '#ffffff',
      paddingX: 24,
      paddingY: 32,
      linkColor: MUTED,
      // No footer block, so the appended line carries the unsubscribe link.
      footerText: 'Your Company Ltd · 123 Example Street, London EC1A 1BB',
    },
    build: () => [
      { id: id('b'), type: 'text', content: 'Hi {{contact.FIRSTNAME}},', style: { fontSize: 15, color: INK } },
      { id: id('b'), type: 'text', content: 'I noticed your team is hiring for two sales roles this quarter. Teams at that stage usually find the list-building is what slows new reps down, not the calls.', style: { fontSize: 15, color: INK } },
      { id: id('b'), type: 'text', content: "We help companies like yours have a verified list ready before a rep's first day. Would a 15-minute call next week be useful? If the timing's wrong, just say so.", style: { fontSize: 15, color: INK } },
      { id: id('b'), type: 'text', content: 'Best,\nAlex', style: { fontSize: 15, color: INK, paddingBottom: 4 } },
      { id: id('b'), type: 'text', content: 'Alex Morgan · Head of Partnerships, Your Company', style: { fontSize: 13, color: '#4b5563' } },
    ],
  },
  {
    id: 'newsletter-editorial',
    name: 'Editorial newsletter',
    description: 'Lead story with a photo, then two smaller pieces, on cards.',
    category: 'Newsletter',
    globalStyle: { ...HOUSE, cardMode: true, canvasBgColor: '#f1eee7', paddingX: 36, paddingY: 32, cardRadius: 8, cardGap: 12, buttonBgColor: '#9a3412' },
    build: () => [
      { id: id('b'), type: 'navigation', content: '◆ Fieldnotes', url: '#', links: [
        { id: id('nl'), label: 'Latest', url: '#' },
        { id: id('nl'), label: 'Archive', url: '#' },
        { id: id('nl'), label: 'About', url: '#' },
      ], style: { paddingTop: 0, paddingBottom: 0, fontFamily: SERIF, fontSize: 21, color: '#9a3412', linkColor: INK } },
      { id: id('b'), type: 'section', content: '', style: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, children: [
        eyebrow('Issue 12 · 25 August', '#9a3412'),
        { id: id('b'), type: 'title', content: 'Is there a perfect time of day to focus?', style: { fontSize: 28, fontFamily: SERIF, color: INK, paddingBottom: 20 } },
        { id: id('b'), type: 'image', content: img('photo-1499750310107-5fef28a66643', 1056, 594), alt: 'A desk with a laptop, a notebook and coffee', style: { paddingBottom: 24 } },
        { id: id('b'), type: 'text', content: 'Open with the one idea the reader came for. Two or three sentences is plenty: the click-through is what matters, not the word count.', style: { fontSize: 16, color: BODY } },
        { id: id('b'), type: 'button', content: 'Read the full story', url: '#', align: 'left', style: { paddingTop: 8, paddingBottom: 0 } },
      ] },
      { id: id('b'), type: 'section', content: '', style: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }, children: [
        { id: id('b'), type: 'title', content: 'Also this week', style: { fontSize: 20, fontFamily: SERIF, color: INK, paddingBottom: 20 } },
        { id: id('b'), type: 'articles', content: '', items: [
          { id: id('it'), image: img('photo-1441974231531-c6227db76b6e', 520, 340), title: 'A shorter path to deep work', text: 'What changed when we cut the meeting block in half.', url: '#', alt: 'Sunlight through a forest' },
          { id: id('it'), image: img('photo-1470071459604-3b5ec3a7fe05', 520, 340), title: 'The quiet hours experiment', text: 'Three weeks of protected mornings, measured properly.', url: '#', alt: 'A green valley under mist' },
        ], style: { paddingBottom: 0, linkColor: '#9a3412', fontFamily: SERIF } },
      ] },
      footer('Fieldnotes', subscribed('Fieldnotes'), { paddingTop: 0 }),
    ],
  },
  {
    id: 'newsletter-digest',
    name: 'Link digest',
    description: 'One column: a short intro and three linked stories.',
    category: 'Newsletter',
    globalStyle: { ...HOUSE, buttonBgColor: '#1d4ed8' },
    build: () => [
      logo('● Margin', 'left', '#1d4ed8'),
      eyebrow('Issue 14 · Friday 13 November', '#1d4ed8'),
      { id: id('b'), type: 'title', content: 'This week in three links', style: { fontSize: 28, color: INK, paddingBottom: 12 } },
      { id: id('b'), type: 'text', content: 'A short note from the editor on why these three are worth your time this week.', style: { fontSize: 16, color: BODY, paddingBottom: 8 } },
      { id: id('b'), type: 'divider', content: '' },
      { id: id('b'), type: 'split', content: 'The case for smaller teams', subContent: 'Why the four-person unit keeps outperforming the twelve-person one, with the numbers behind it.', subImage: img('photo-1522071820081-009f0129c71c', 480, 360), url: '#', alt: 'A small team around a laptop', style: STORY },
      { id: id('b'), type: 'divider', content: '' },
      { id: id('b'), type: 'split', content: 'What we got wrong about onboarding', subContent: 'Six months of session recordings, and the one step everybody skipped.', subImage: img('photo-1531482615713-2afd69097998', 480, 360), url: '#', alt: 'Two people in a meeting', style: STORY },
      { id: id('b'), type: 'divider', content: '' },
      { id: id('b'), type: 'split', content: 'Planning on one wall', subContent: 'How one team put its whole quarter on a whiteboard, and what it stopped doing.', subImage: img('photo-1531403009284-440f080d1e12', 480, 360), url: '#', alt: 'A hand pinning notes to a planning wall', style: STORY },
      { id: id('b'), type: 'divider', content: '' },
      { id: id('b'), type: 'button', content: 'Browse the archive', url: '#', align: 'left', style: { paddingTop: 8 } },
      footer('Margin', subscribed('Margin')),
    ],
  },
  {
    id: 'product-update',
    name: 'Product update',
    description: "What shipped this month, what improved and what's fixed.",
    category: 'Announcement',
    globalStyle: { ...HOUSE, buttonBgColor: '#0f766e', linkColor: '#0f766e' },
    build: () => [
      logo('▲ Apex', 'left', '#0f766e'),
      eyebrow('Product update · November', '#0f766e'),
      { id: id('b'), type: 'title', content: 'Three things we shipped this month', style: { fontSize: 28, color: INK, paddingBottom: 12 } },
      { id: id('b'), type: 'text', content: 'A quick round-up of what changed, so you can make the most of it. Everything below is live in your account today.', style: { fontSize: 16, color: BODY, paddingBottom: 24 } },
      { id: id('b'), type: 'image', content: img('photo-1551288049-bebda4e38f71', 1040, 520), alt: 'A laptop showing charts', style: { paddingBottom: 28 } },
      { id: id('b'), type: 'notice', content: 'Learn more', items: [
        { id: id('it'), image: '', badge: 'New', badgeColor: '#0f766e', title: 'Saved views', text: 'Keep the filters you use every day one click away, and share them with your team.', url: '#' },
        { id: id('it'), image: '', badge: 'Improved', badgeColor: '#1d4ed8', title: 'Faster imports', text: 'Lists of 50,000 rows now import in under a minute, with a clear report of anything skipped.', url: '#' },
        { id: id('it'), image: '', badge: 'Fixed', badgeColor: '#4b5563', title: 'Time zones in reports', text: 'Reports now use your own time zone, so the week starts when you expect it to.' },
      ] },
      { id: id('b'), type: 'button', content: "See everything that's new", url: '#', align: 'left', style: { paddingTop: 8 } },
      footer('Apex', customer('Apex')),
    ],
  },
  {
    id: 'event-invite',
    name: 'Event invite',
    description: 'A webinar or event: what, when, and one button to register.',
    category: 'Announcement',
    globalStyle: { ...HOUSE, buttonBgColor: '#4338ca' },
    build: () => [
      logo('● Lumen', 'center', '#4338ca'),
      eyebrow('Live webinar', '#4338ca', { textAlign: 'center' }),
      { id: id('b'), type: 'title', content: 'Pipelines that fill themselves', align: 'center', style: { fontSize: 28, color: INK, textAlign: 'center', paddingBottom: 12 } },
      { id: id('b'), type: 'text', content: 'A 40-minute walkthrough of how B2B teams build a qualified prospect list in an afternoon, with time for your questions at the end.', style: { fontSize: 16, color: BODY, textAlign: 'center', paddingBottom: 24 } },
      { id: id('b'), type: 'section', content: '', style: { bgColor: '#eef2ff', borderRadius: 8, paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20 }, children: [
        { id: id('b'), type: 'text', content: 'Thursday 26 November · 4pm GMT', style: { fontSize: 17, fontWeight: 'bold', color: INK, textAlign: 'center', paddingBottom: 2 } },
        { id: id('b'), type: 'text', content: 'Online · 40 minutes · Free', style: { fontSize: 14, color: '#4b5563', textAlign: 'center', paddingBottom: 0 } },
      ] },
      { id: id('b'), type: 'button', content: 'Save my seat', url: '#', align: 'center', style: { paddingTop: 28, paddingBottom: 12 } },
      { id: id('b'), type: 'social', content: '', align: 'center', socials: [
        { id: id('so'), label: 'Add to Google Calendar', url: '#' },
        { id: id('so'), label: 'Outlook', url: '#' },
        { id: id('so'), label: 'Apple Calendar', url: '#' },
      ], style: { color: '#4338ca', paddingTop: 0, paddingBottom: 24 } },
      { id: id('b'), type: 'divider', content: '', style: { paddingTop: 0 } },
      { id: id('b'), type: 'text', content: 'Hosted by Priya Raman, Head of Growth at Lumen.', style: { fontSize: 14, color: BODY, textAlign: 'center', paddingBottom: 4 } },
      { id: id('b'), type: 'text', content: "Can't make it? Register anyway and we'll send you the recording.", style: { fontSize: 13, color: MUTED, textAlign: 'center' } },
      footer('Lumen', subscribed('Lumen')),
    ],
  },
  {
    id: 'case-study',
    name: 'Case study',
    description: 'A customer story: the result, a quote and the numbers.',
    category: 'Announcement',
    globalStyle: { ...HOUSE, buttonBgColor: '#166534' },
    build: () => [
      logo('◆ Brightline', 'left', '#166534'),
      eyebrow('Customer story', '#166534'),
      { id: id('b'), type: 'title', content: 'How Larkspur cut list-building from a week to an afternoon', style: { fontSize: 28, color: INK, paddingBottom: 24 } },
      { id: id('b'), type: 'image', content: img('photo-1600880292203-757bb62b4baf', 1040, 520), alt: 'Two colleagues celebrating at a desk', style: { paddingBottom: 28 } },
      { id: id('b'), type: 'section', content: '', style: { bgColor: '#f0fdf4', borderRadius: 8, paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24 }, children: [
        { id: id('b'), type: 'text', content: '“We used to lose Mondays to spreadsheets. Now the list is ready before the kick-off call.”', style: { fontSize: 20, fontWeight: 'bold', color: '#14532d', paddingBottom: 8 } },
        { id: id('b'), type: 'text', content: 'Marcus Webb, CTO at Larkspur Analytics', style: { fontSize: 14, color: '#3f6212', paddingBottom: 0 } },
      ] },
      { id: id('b'), type: 'title', content: '6 hours → 40 minutes', style: { fontSize: 32, color: '#166534', paddingTop: 32, paddingBottom: 0 } },
      { id: id('b'), type: 'text', content: 'to build a list of 500 decision-makers', style: { fontSize: 15, color: BODY, paddingBottom: 20 } },
      { id: id('b'), type: 'title', content: '3× the replies', style: { fontSize: 32, color: '#166534', paddingBottom: 0 } },
      { id: id('b'), type: 'text', content: 'from emails written for each person', style: { fontSize: 15, color: BODY, paddingBottom: 8 } },
      { id: id('b'), type: 'button', content: 'Read the full story', url: '#', align: 'left', style: { paddingTop: 16 } },
      footer('Brightline', subscribed('Brightline')),
    ],
  },
  {
    id: 'ecommerce-drop',
    name: 'Product drop',
    description: 'A hero photo over a two-up grid of products with prices.',
    category: 'E-commerce',
    globalStyle: { ...HOUSE, paddingX: 32, paddingY: 32 },
    build: () => [
      { id: id('b'), type: 'navigation', content: '■ Common Goods', url: '#', links: [
        { id: id('nl'), label: 'New in', url: '#' },
        { id: id('nl'), label: 'Sale', url: '#' },
      ], style: { paddingTop: 0, paddingBottom: 20, fontSize: 19, color: INK } },
      { id: id('b'), type: 'image', content: img('photo-1441986300917-64674bd600d8', 1072, 600), alt: 'The new season collection', style: { paddingBottom: 28 } },
      { id: id('b'), type: 'title', content: 'The autumn drop is live', align: 'center', style: { fontSize: 28, color: INK, textAlign: 'center', paddingBottom: 12 } },
      { id: id('b'), type: 'text', content: "Fourteen new pieces, made in limited runs. Once they're gone, they're gone.", style: { fontSize: 16, color: BODY, textAlign: 'center', paddingBottom: 28 } },
      { id: id('b'), type: 'product', content: 'Add to bag', items: [
        { id: id('it'), image: img('photo-1521572163474-6864f9cf17ab', 500, 600), title: 'Heavyweight tee', text: 'Organic cotton', price: '£29.00', comparePrice: '£39.00', url: '#', alt: 'Heavyweight tee' },
        { id: id('it'), image: img('photo-1576566588028-4147f3842f27', 500, 600), title: 'Boxy crew', text: 'Loop-back sweat', price: '£65.00', url: '#', alt: 'Boxy crew sweatshirt' },
      ] },
      { id: id('b'), type: 'button', content: 'Shop the full collection', url: '#', align: 'center', style: { paddingTop: 12 } },
      footer('Common Goods', subscribed('Common Goods')),
    ],
  },
  {
    id: 'ecommerce-sale',
    name: 'Sale announcement',
    description: 'A dark promo panel with a code, over a four-item grid.',
    category: 'E-commerce',
    // No body padding, so the dark panel runs edge to edge; the blocks under it pad themselves.
    globalStyle: { ...HOUSE, canvasBgColor: '#18181b', paddingX: 0, paddingY: 0, buttonBgColor: '#dc2626' },
    build: () => [
      { id: id('b'), type: 'section', content: '', style: { bgColor: '#18181b', paddingTop: 48, paddingBottom: 48, paddingLeft: 32, paddingRight: 32 }, children: [
        { id: id('c'), type: 'logo', content: '■ Common Goods', align: 'center', style: { fontSize: 19, color: '#ffffff', paddingTop: 0, paddingBottom: 24 } },
        { id: id('c'), type: 'title', content: '30% off everything', align: 'center', style: { color: '#ffffff', fontSize: 36, textAlign: 'center', paddingBottom: 8 } },
        { id: id('c'), type: 'text', content: 'Three days only, ending Sunday at midnight.', style: { color: '#e4e4e7', fontSize: 16, textAlign: 'center', paddingBottom: 16 } },
        // The code as a chip of its own, easy to spot and copy.
        { id: id('c'), type: 'text', content: 'Code AUTUMN30', width: '46%', align: 'center', style: { bgColor: '#3f3f46', color: '#ffffff', fontFamily: MONO, fontSize: 16, fontWeight: 'bold', textAlign: 'center', paddingTop: 10, paddingBottom: 10 } },
        { id: id('c'), type: 'button', content: 'Shop the sale', url: '#', align: 'center', style: { paddingTop: 24, paddingBottom: 0 } },
      ] },
      { id: id('b'), type: 'spacer', content: '32' },
      // Dark buttons on the products, so the panel's red one is the main action.
      { id: id('b'), type: 'product', content: 'Shop now', items: [
        { id: id('it'), image: img('photo-1523381210434-271e8be1f52b', 500, 500), title: 'Everyday tee', text: '', price: '£21.00', comparePrice: '£30.00', url: '#', alt: 'T-shirts on a rail' },
        { id: id('it'), image: img('photo-1505740420928-5e560c06d30e', 500, 500), title: 'Over-ear headphones', text: '', price: '£63.00', comparePrice: '£90.00', url: '#', alt: 'Black headphones on yellow' },
        { id: id('it'), image: img('photo-1553062407-98eeb64c6a62', 500, 500), title: 'Canvas backpack', text: '', price: '£56.00', comparePrice: '£80.00', url: '#', alt: 'A canvas backpack' },
        { id: id('it'), image: img('photo-1523275335684-37898b6baf30', 500, 500), title: 'Minimal watch', text: '', price: '£42.00', comparePrice: '£60.00', url: '#', alt: 'A white watch' },
      ], style: { color: INK, paddingLeft: 32, paddingRight: 32, btnBgColor: '#18181b' } },
      footer('Common Goods', subscribed('Common Goods'), { paddingTop: 8, paddingBottom: 32, paddingLeft: 32, paddingRight: 32 }),
    ],
  },
  {
    id: 'welcome-onboarding',
    name: 'Welcome & onboarding',
    description: 'A greeting, three first steps and one call to action.',
    category: 'Transactional',
    globalStyle: { ...HOUSE, buttonBgColor: '#6d28d9' },
    build: () => [
      logo('◆ Harbor', 'center', '#6d28d9'),
      { id: id('b'), type: 'title', content: 'Welcome aboard, {{contact.FIRSTNAME}}', align: 'center', style: { fontSize: 28, color: INK, textAlign: 'center', paddingBottom: 12 } },
      { id: id('b'), type: 'text', content: 'Your account is ready. Here are the three things worth doing first.', style: { fontSize: 16, color: BODY, textAlign: 'center', paddingBottom: 28 } },
      { id: id('b'), type: 'columns', content: '', items: [
        { id: id('it'), image: img('photo-1434030216411-0b793f4b4173', 360, 240), title: 'Import your data', text: 'Bring your existing list across in one upload.', alt: 'Someone writing notes at a desk' },
        { id: id('it'), image: img('photo-1519389950473-47ba0277781c', 360, 240), title: 'Invite your team', text: 'Everyone works from the same campaigns.', alt: 'A team working at one table' },
        { id: id('it'), image: img('photo-1486312338219-ce68d2c6f44d', 360, 240), title: 'Send your first', text: 'Start from a template and edit in place.', alt: 'Hands typing on a laptop' },
      ] },
      { id: id('b'), type: 'button', content: 'Open your dashboard', url: '#', align: 'center', style: { paddingTop: 12 } },
      footer('Harbor', customer('Harbor')),
    ],
  },
  {
    id: 'password-reset',
    name: 'Password reset',
    description: 'A single-purpose account email with one clear action.',
    category: 'Transactional',
    globalStyle: { ...HOUSE, paddingX: 60, buttonBgColor: '#0f766e' },
    build: () => [
      logo('▲ Apex', 'center', '#0f766e'),
      { id: id('b'), type: 'title', content: 'Reset your password', align: 'center', style: { fontSize: 24, color: INK, textAlign: 'center', paddingBottom: 12 } },
      { id: id('b'), type: 'text', content: 'We received a request to reset the password for your account. Choose a new one with the button below: the link works for the next hour.', style: { fontSize: 15, color: BODY, textAlign: 'center', paddingBottom: 8 } },
      { id: id('b'), type: 'button', content: 'Choose a new password', url: '#', align: 'center' },
      { id: id('b'), type: 'text', content: "Didn't ask for this? You can ignore this email and your password stays the same.", style: { fontSize: 13, color: MUTED, textAlign: 'center', paddingTop: 8 } },
      { id: id('b'), type: 'divider', content: '' },
      { id: id('b'), type: 'text', content: 'Trouble with the button? Paste this link into your browser:\nhttps://example.com/reset?token=…', style: { fontSize: 12, color: MUTED, textAlign: 'center' } },
    ],
  },
]
