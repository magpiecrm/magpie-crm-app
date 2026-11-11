// Phrases spam filters look for, lower case, and the single words that sell.
// A phrase counts whole; a word like "free" or "offer" is in plenty of
// ordinary business email, so one counts for little (content.ts), and only
// where it isn't already part of a phrase.

export const TRIGGER_PHRASES = [
  '100% free',
  '100% guaranteed',
  '100% satisfied',
  'act immediately',
  'act now',
  'action required',
  'amazing deal',
  'apply now',
  'as seen on',
  'be your own boss',
  'best price',
  'big bucks',
  'buy direct',
  'buy now',
  'call now',
  'cash bonus',
  'click below',
  'click here',
  'congratulations',
  'dear friend',
  'dear sir or madam',
  "don't delete",
  'double your',
  'earn extra cash',
  'earn money',
  'eliminate debt',
  'exclusive deal',
  'expires today',
  'extra income',
  'fast cash',
  'final notice',
  'financial freedom',
  'free gift',
  'free money',
  'get paid',
  'get it now',
  'great offer',
  'guaranteed results',
  'hidden charges',
  'instant access',
  'last chance',
  'limited time',
  'lowest price',
  'make money',
  'million dollars',
  'money back',
  'no catch',
  'no cost',
  'no credit check',
  'no fees',
  'no obligation',
  'no strings attached',
  'not spam',
  'offer expires',
  'once in a lifetime',
  'order now',
  'pure profit',
  'risk-free',
  'risk free',
  'satisfaction guaranteed',
  'special promotion',
  "this isn't spam",
  'this is not spam',
  "this won't last",
  'urgent',
  'while supplies last',
  'winner',
  'work from home',
  'you have been selected',
  "you've been selected",
  // From the free spam checker on magpiecrm.com (its spamRules.ts), which found these missing.
  'account has been suspended',
  'account suspended',
  'act fast',
  'best deal',
  'buy today',
  'cash prize',
  'claim now',
  'claim your',
  'click now',
  'click the link below',
  'confirm your account',
  'dear customer',
  'dear valued customer',
  "don't miss out",
  'exclusive offer',
  'for free',
  'free access',
  'free offer',
  'free trial',
  'get rich',
  'hurry up',
  'incredible deal',
  'investment opportunity',
  'limited offer',
  'lose weight',
  'no risk',
  'order today',
  'special offer',
  'today only',
  'unbelievable',
  'verify your account',
  'wire transfer',
  'you have won',
  "you've won",
]

/** Words that sell, lower case. Each is in plenty of ordinary business email, so one counts for little; a few, or one in the subject, for more. */
const SALESY_WORDS = new Set([
  'free', 'offer', 'offers', 'deal', 'deals', 'discount', 'discounted', 'save', 'savings', 'cheap', 'cheapest', 'bargain',
  'bonus', 'prize', 'cash', 'guarantee', 'guaranteed', 'hurry', 'limited', 'exclusive', 'promo', 'promotion', 'sale',
  'clearance', 'amazing', 'incredible', 'miracle', 'lowest', 'buy', 'giveaway', 'freebie',
])
/** Forms of one salesy word, counted as that word: "deal" and "deals" are one. */
const SAME_WORD: Record<string, string> = { offers: 'offer', deals: 'deal', discounted: 'discount', savings: 'save', cheapest: 'cheap', guaranteed: 'guarantee' }

/** Shouting one of these in capitals, even once, is selling at someone. */
export const SHOUT_WORDS = new Set([
  'FREE', 'NOW', 'URGENT', 'TODAY', 'LIMITED', 'BUY', 'ORDER', 'CALL', 'CLICK', 'ACT', 'HURRY', 'LAST', 'FINAL', 'WIN',
  'WINNER', 'SAVE', 'OFF', 'SALE', 'DEAL', 'OFFER', 'CASH', 'MONEY', 'GUARANTEED', 'IMPORTANT', 'ATTENTION', 'WARNING',
  'EXCLUSIVE', 'BONUS', 'PRIZE', 'ONLY', 'BEST', 'AMAZING', 'CONGRATULATIONS', 'ALERT',
])

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PATTERNS = TRIGGER_PHRASES.map((p) => ({ phrase: p, re: new RegExp(`(^|[^a-z0-9])${escape(p)}($|[^a-z0-9])`, 'i') }))

const plainText = (text: string) => text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ')

/** The trigger phrases in a text, each once. Curly apostrophes count as straight ones. */
export function triggerPhrases(text: string): string[] {
  const plain = plainText(text)
  return PATTERNS.filter(({ re }) => re.test(plain)).map(({ phrase }) => phrase)
}

/**
 * The salesy words in a text, each once (a word and its plural are one), lower case. One inside a trigger phrase the text has
 * (`phrases`, as triggerPhrases gives them) isn't counted again, nor "Limited" closing a
 * company's name ("Acme Widgets Limited"). Take links out of the text first.
 */
export function salesyWords(text: string, phrases: string[]): string[] {
  let plain = plainText(text)
  for (const p of phrases) plain = plain.replace(new RegExp(escape(p), 'gi'), ' ')
  plain = plain.replace(/(?<=\p{Lu}[\p{L}&'.-]*[ \t]+)Limited\b/gu, ' ')
  const words = plain.toLowerCase().match(/\p{L}+/gu) ?? []
  return [...new Set(words.filter((w) => SALESY_WORDS.has(w)).map((w) => SAME_WORD[w] ?? w))]
}
