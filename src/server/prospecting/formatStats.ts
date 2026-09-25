// How often people use the first.last format, by company size, from
// Sendburg's 2026 study of 336,782 B2B work emails
// (send-burg.com/research/b2b-email-formats). Used to say how likely an
// unconfirmable best guess is, instead of just "unverified".

const FIRST_LAST_BY_SIZE: Array<[maxStaff: number, share: number, label: string]> = [
  [10, 38.0, '1–10 people'],
  [50, 36.3, '11–50 people'],
  [200, 45.2, '51–200 people'],
  [500, 47.3, '201–500 people'],
  [1000, 52.8, '501–1,000 people'],
  [5000, 63.2, '1,001–5,000 people'],
  [10000, 68.2, '5,001–10,000 people'],
  [Number.POSITIVE_INFINITY, 74.2, '10,000+ people'],
]
const FIRST_LAST_OVERALL = 47.7

/** e.g. "About 74% of people at companies of 10,000+ people use this format." */
export function firstLastLikelihood(headcount: number | null | undefined): string {
  if (!headcount || headcount < 1) return `About ${Math.round(FIRST_LAST_OVERALL)}% of work emails use this format.`
  const [, share, label] = FIRST_LAST_BY_SIZE.find(([max]) => headcount <= max)!
  return `About ${Math.round(share)}% of people at companies of ${label} use this format.`
}
