/**
 * Starter templates.
 *
 * The layouts are modelled on the MySigMail HTML email templates
 * (https://github.com/mysigmail/html-email-templates, MIT, (c) Anton Reshetov)
 * and rebuilt from scratch in this builder's block model — no markup or CSS is
 * copied.
 *
 * Every image points at a public placeholder the user is expected to swap for
 * their own.
 */
import type { EmailBlock, GlobalStyle } from '../types'

const img = (id: string, w: number) => `https://images.unsplash.com/${id}?w=${w}&auto=format&fit=crop`

export interface StarterTemplate {
  id: string
  name: string
  description: string
  category: 'Newsletter' | 'E-commerce' | 'Transactional'
  /** Partial override merged onto the current global style when applied. */
  globalStyle: Partial<GlobalStyle>
  /** Built fresh per call so ids are unique and blocks are never shared by reference. */
  build: () => EmailBlock[]
}

let seq = 0
const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`

const socials = () => [
  { id: id('so'), label: 'Twitter', url: 'https://twitter.com' },
  { id: id('so'), label: 'LinkedIn', url: 'https://linkedin.com' },
  { id: id('so'), label: 'Instagram', url: 'https://instagram.com' },
]

const footerLinks = () => [
  { id: id('fl'), label: 'Unsubscribe', url: '{{ unsubscribe }}' },
  { id: id('fl'), label: 'Privacy', url: '#' },
  { id: id('fl'), label: 'Contact', url: '#' },
]

const address = 'Your Company Ltd, 123 Example Street, London, EC1A 1BB\nYou are receiving this because you subscribed to our updates.'

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'newsletter-editorial',
    name: 'Editorial newsletter',
    description: 'Card layout: nav bar, dated lead story, and a two-up article row.',
    category: 'Newsletter',
    globalStyle: { cardMode: true, canvasBgColor: '#f5f5f5', bodyBgColor: '#ffffff', paddingX: 35, paddingY: 30, cardRadius: 5, cardGap: 10 },
    build: () => [
      { id: id('b'), type: 'navigation', content: 'MY BRAND', url: '#', links: [
        { id: id('nl'), label: 'Latest', url: '#' },
        { id: id('nl'), label: 'Archive', url: '#' },
        { id: id('nl'), label: 'About', url: '#' },
      ] },
      { id: id('b'), type: 'text', content: 'Issue 12 · 25 August', align: 'center', style: { fontSize: 13, color: '#aaaaaa', textAlign: 'center' } },
      { id: id('b'), type: 'title', content: 'Is there a perfect time of day to focus?', style: { fontSize: 26, textAlign: 'center' } },
      { id: id('b'), type: 'image', content: img('photo-1499750310107-5fef28a66643', 800), alt: 'A desk with a notebook and coffee', style: { paddingTop: 20, paddingBottom: 20 } },
      { id: id('b'), type: 'text', content: 'Open with the one idea the reader came for. Two or three sentences is plenty — the click-through is what matters, not the word count.', style: { fontSize: 15 } },
      { id: id('b'), type: 'button', content: 'Read the full story', url: '#', align: 'center', style: { paddingTop: 20 } },
      { id: id('b'), type: 'title', content: 'Also this week', style: { fontSize: 18 } },
      { id: id('b'), type: 'articles', content: '', items: [
        { id: id('it'), image: img('photo-1441974231531-c6227db76b6e', 400), title: 'A shorter path to deep work', text: 'What changed when we cut the meeting block in half.', url: '#', alt: '' },
        { id: id('it'), image: img('photo-1470071459604-3b5ec3a7fe05', 400), title: 'The quiet hours experiment', text: 'Three weeks of protected mornings, measured properly.', url: '#', alt: '' },
      ] },
      { id: id('b'), type: 'footer', content: address, links: footerLinks(), socials: socials(), style: { bgColor: '#ffffff' } },
    ],
  },
  {
    id: 'newsletter-digest',
    name: 'Link digest',
    description: 'Plain single-column digest — logo, intro, three linked stories.',
    category: 'Newsletter',
    globalStyle: { cardMode: false, canvasBgColor: '#eeeeee', bodyBgColor: '#ffffff', paddingX: 35, paddingY: 35 },
    build: () => [
      { id: id('b'), type: 'logo', content: 'MY BRAND', align: 'center' },
      { id: id('b'), type: 'title', content: 'This week in five links', align: 'center', style: { fontSize: 24, textAlign: 'center' } },
      { id: id('b'), type: 'text', content: 'A short note from the editor explaining why these five are worth your time.', style: { textAlign: 'center', paddingBottom: 8 } },
      { id: id('b'), type: 'divider', content: '' },
      { id: id('b'), type: 'split', content: 'The case for smaller teams', subContent: 'Why the four-person unit keeps outperforming the twelve-person one, with the numbers behind it.', subImage: img('photo-1522071820081-009f0129c71c', 400), url: '#' },
      { id: id('b'), type: 'divider', content: '' },
      { id: id('b'), type: 'split', content: 'What we got wrong about onboarding', subContent: 'Six months of session recordings, and the one step everybody skipped.', subImage: img('photo-1531482615713-2afd69097998', 400), url: '#', align: 'right' },
      { id: id('b'), type: 'divider', content: '' },
      { id: id('b'), type: 'button', content: 'Browse the archive', url: '#', align: 'center' },
      { id: id('b'), type: 'footer', content: address, links: footerLinks(), socials: socials(), style: { borderColor: '#e5e7eb' } },
    ],
  },
  {
    id: 'ecommerce-drop',
    name: 'Product drop',
    description: 'Announcement hero over a two-up product grid with prices.',
    category: 'E-commerce',
    globalStyle: { cardMode: false, canvasBgColor: '#f5f5f5', bodyBgColor: '#ffffff', paddingX: 30, paddingY: 30, buttonRadius: 24 },
    build: () => [
      { id: id('b'), type: 'navigation', content: 'MY BRAND', url: '#', links: [
        { id: id('nl'), label: 'New in', url: '#' },
        { id: id('nl'), label: 'Sale', url: '#' },
      ] },
      { id: id('b'), type: 'image', content: img('photo-1441986300917-64674bd600d8', 800), alt: 'The new season collection', style: { paddingBottom: 24 } },
      { id: id('b'), type: 'title', content: 'The autumn drop is live', align: 'center', style: { fontSize: 28, textAlign: 'center' } },
      { id: id('b'), type: 'text', content: 'Fourteen new pieces, made in limited runs. Once they are gone, they are gone.', style: { textAlign: 'center', paddingBottom: 8 } },
      { id: id('b'), type: 'product', content: 'Add to bag', items: [
        { id: id('it'), image: img('photo-1521572163474-6864f9cf17ab', 400), title: 'Heavyweight tee', text: 'Organic cotton', price: '£29.00', comparePrice: '£39.00', url: '#', alt: 'Heavyweight tee' },
        { id: id('it'), image: img('photo-1576566588028-4147f3842f27', 400), title: 'Boxy crew', text: 'Loop-back sweat', price: '£65.00', url: '#', alt: 'Boxy crew sweatshirt' },
      ] },
      { id: id('b'), type: 'button', content: 'Shop the full collection', url: '#', align: 'center', style: { paddingTop: 28 } },
      { id: id('b'), type: 'footer', content: address, links: footerLinks(), socials: socials(), style: { borderColor: '#e5e7eb' } },
    ],
  },
  {
    id: 'ecommerce-sale',
    name: 'Sale announcement',
    description: 'High-contrast promo panel with a four-item product grid.',
    category: 'E-commerce',
    globalStyle: { cardMode: false, canvasBgColor: '#111827', bodyBgColor: '#ffffff', paddingX: 30, paddingY: 0, buttonBgColor: '#dc2626', buttonRadius: 0 },
    build: () => [
      { id: id('b'), type: 'section', content: '', style: { bgColor: '#111827', paddingTop: 40, paddingBottom: 40, paddingLeft: 24, paddingRight: 24 }, children: [
        { id: id('c'), type: 'logo', content: 'MY BRAND', align: 'center', style: { color: '#ffffff' } },
        { id: id('c'), type: 'title', content: '30% off everything', align: 'center', style: { color: '#ffffff', fontSize: 34, textAlign: 'center' } },
        { id: id('c'), type: 'text', content: 'Three days only. Use code AUTUMN30 at checkout.', style: { color: '#d1d5db', textAlign: 'center' } },
      ] },
      { id: id('b'), type: 'spacer', content: '30' },
      { id: id('b'), type: 'product', content: 'Shop now', items: [
        { id: id('it'), image: img('photo-1523381210434-271e8be1f52b', 400), title: 'Utility jacket', text: '', price: '£84.00', comparePrice: '£120.00', url: '#', alt: 'Utility jacket' },
        { id: id('it'), image: img('photo-1542291026-7eec264c27ff', 400), title: 'Court trainer', text: '', price: '£63.00', comparePrice: '£90.00', url: '#', alt: 'Court trainer' },
        { id: id('it'), image: img('photo-1553062407-98eeb64c6a62', 400), title: 'Canvas tote', text: '', price: '£21.00', comparePrice: '£30.00', url: '#', alt: 'Canvas tote' },
        { id: id('it'), image: img('photo-1591561954557-26941169b49e', 400), title: 'Wool beanie', text: '', price: '£17.50', comparePrice: '£25.00', url: '#', alt: 'Wool beanie' },
      ] },
      { id: id('b'), type: 'spacer', content: '20' },
      { id: id('b'), type: 'footer', content: address, links: footerLinks(), socials: socials(), style: { borderColor: '#e5e7eb' } },
    ],
  },
  {
    id: 'password-reset',
    name: 'Password reset',
    description: 'Single-purpose transactional email with one clear action.',
    category: 'Transactional',
    globalStyle: { cardMode: false, canvasBgColor: '#f3f4f6', bodyBgColor: '#ffffff', bodyWidth: 520, paddingX: 40, paddingY: 40, footerText: '' },
    build: () => [
      { id: id('b'), type: 'logo', content: 'MY BRAND', align: 'center' },
      { id: id('b'), type: 'title', content: 'Reset your password', align: 'center', style: { fontSize: 24, textAlign: 'center', paddingTop: 8 } },
      { id: id('b'), type: 'text', content: 'We received a request to reset the password for your account. Click the button below to choose a new one. This link expires in 60 minutes.', style: { textAlign: 'center', paddingTop: 12, paddingBottom: 8 } },
      { id: id('b'), type: 'button', content: 'Choose a new password', url: '#', align: 'center' },
      { id: id('b'), type: 'text', content: 'If you did not request this, you can safely ignore this email — your password will not change.', style: { fontSize: 13, color: '#9ca3af', textAlign: 'center', paddingTop: 20 } },
      { id: id('b'), type: 'divider', content: '' },
      { id: id('b'), type: 'text', content: 'Trouble with the button? Paste this link into your browser:\nhttps://example.com/reset?token=...', style: { fontSize: 12, color: '#9ca3af', textAlign: 'center' } },
    ],
  },
  {
    id: 'welcome-onboarding',
    name: 'Welcome & onboarding',
    description: 'Greeting, a three-step feature row, and a single call to action.',
    category: 'Transactional',
    globalStyle: { cardMode: false, canvasBgColor: '#f5f5f5', bodyBgColor: '#ffffff', paddingX: 35, paddingY: 35 },
    build: () => [
      { id: id('b'), type: 'logo', content: 'MY BRAND', align: 'center' },
      { id: id('b'), type: 'title', content: 'Welcome aboard, {{contact.FIRSTNAME}}', align: 'center', style: { fontSize: 26, textAlign: 'center' } },
      { id: id('b'), type: 'text', content: 'Your account is ready. Here are the three things worth doing first.', style: { textAlign: 'center', paddingBottom: 12 } },
      { id: id('b'), type: 'columns', content: '', items: [
        { id: id('it'), image: img('photo-1454165804606-c3d57bc86b40', 300), title: 'Import your data', text: 'Bring your existing list across in one upload.', alt: '' },
        { id: id('it'), image: img('photo-1552664730-d307ca884978', 300), title: 'Invite your team', text: 'Everyone works from the same campaigns.', alt: '' },
        { id: id('it'), image: img('photo-1460925895917-afdab827c52f', 300), title: 'Send your first', text: 'Start from a template and edit in place.', alt: '' },
      ] },
      { id: id('b'), type: 'button', content: 'Open your dashboard', url: '#', align: 'center', style: { paddingTop: 28 } },
      { id: id('b'), type: 'footer', content: address, links: footerLinks(), socials: socials(), style: { borderColor: '#e5e7eb' } },
    ],
  },
]
