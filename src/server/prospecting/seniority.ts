import type { Seniority } from './types'

// SocialFetch has no seniority filter, so seniority is classified from the job
// title. Order matters: the first matching rule wins, so "Founder & CEO" is a
// founder and "Senior Director" is a director.
const RULES: Array<[Seniority, RegExp]> = [
  ['owner', /\b(owner|proprietor)\b/],
  ['founder', /\b(co-?founder|founder|founding partner)\b/],
  ['c_suite', /\b(ceo|cto|cfo|coo|cmo|cio|ciso|cro|cpo|cco|chro|chief|managing director|president)\b/],
  ['partner', /\bpartner\b/],
  ['vp', /\b(vp|svp|evp|avp|vice[\s-]president)\b/],
  ['head', /\bhead\b/],
  ['director', /\bdirector\b/],
  ['manager', /\b(manager|mgr)\b/],
  ['senior', /\b(senior|sr|principal|staff|lead)\b/],
  ['intern', /\b(intern|internship|trainee|apprentice|placement)\b/],
  ['entry', /\b(junior|jr|graduate|entry[\s-]level|assistant|associate)\b/],
]

export function classifySeniority(title: string): Seniority | null {
  const t = title.toLowerCase().replace(/[.,/&|]/g, ' ')
  if (!t.trim()) return null
  // "Vice President" contains "president"; resolve it before the c_suite rule.
  if (/\bvice[\s-]president\b/.test(t)) return 'vp'
  for (const [level, re] of RULES) {
    if (re.test(t)) return level
  }
  return null
}

/**
 * Maps the persona form's display vocabulary ("C-Level", "VP") onto the
 * internal levels. Unknown labels are dropped rather than guessed.
 */
export function parseSeniorityLabel(label: string): Seniority | null {
  const key = label.toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (key === 'c_level' || key === 'c_suite' || key === 'csuite') return 'c_suite'
  const direct: Record<string, Seniority> = {
    owner: 'owner', founder: 'founder', partner: 'partner', vp: 'vp', head: 'head',
    director: 'director', manager: 'manager', senior: 'senior', entry: 'entry', intern: 'intern',
  }
  return direct[key] ?? null
}
