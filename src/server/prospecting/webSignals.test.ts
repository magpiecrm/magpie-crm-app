import { describe, expect, it } from 'vitest'
import { fundingQuery, hiringQuery, isAmbiguous, parseFunding, parseHiring, resultDate } from './webSignals'
import type { WebResult } from './webSearch'

// Made-up companies, with results shaped like the ones real searches return
// (checked against 80 companies' searches on 2026-10-16).
const now = new Date('2026-10-16T12:00:00Z')
const r = (url: string, title: string, description: string): WebResult => ({ url, title, description })

describe('queries', () => {
  it('put the plain name in quotes, with no OR or brackets', () => {
    expect(hiringQuery({ name: 'Larkspur Labs Ltd' })).toBe('"Larkspur Labs" careers jobs')
    expect(fundingQuery({ name: 'Larkspur Labs (UK) Limited' })).toBe('"Larkspur Labs" funding round')
  })
})

describe('resultDate', () => {
  it('reads Google’s date in front of a snippet', () => {
    expect(resultDate(r('', '', '24 Nov 2025 — Larkspur …'), now)?.toISOString().slice(0, 10)).toBe('2025-11-24')
    expect(resultDate(r('', '', 'Sep 26, 2025 — As an SDR …'), now)?.toISOString().slice(0, 10)).toBe('2025-09-26')
    expect(resultDate(r('', '', '8 days ago — Larkspur has …'), now)?.toISOString().slice(0, 10)).toBe('2026-10-08')
    expect(resultDate(r('', '', 'Larkspur is a studio'), now)).toBeNull()
  })
})

describe('parseHiring', () => {
  const larkspur = { name: 'Larkspur Labs Ltd', domain: 'larkspurlabs.com' }

  it('takes the company’s own page on an applicant-tracking system', () => {
    const s = parseHiring(larkspur, [r('https://jobs.ashbyhq.com/larkspurlabs', 'Larkspur Labs', 'Open Positions (6). Filters: Department …')], now)
    expect(s).toMatchObject({ kind: 'hiring', label: 'Hiring · 6 open roles', source: 'web' })
  })

  it('not a page of the same name that is another company’s, nor one with nothing open', () => {
    expect(parseHiring({ name: 'Bramble', domain: 'hellobramble.com' }, [r('https://jobs.ashbyhq.com/bramble', 'Bramble', 'Open Positions (6).')], now)).toBeNull()
    expect(parseHiring(larkspur, [r('https://jobs.ashbyhq.com/larkspurlabs', 'Larkspur Labs', 'Open Positions (0). Filters: Department …')], now)).toBeNull()
  })

  it('takes its own careers page when it says jobs are open, not when it says there are none', () => {
    expect(parseHiring(larkspur, [r('https://www.larkspurlabs.com/careers', 'Careers | Larkspur Labs', 'Larkspur Labs is hiring! We are looking for a Product Designer.')], now)).toMatchObject({ label: 'Hiring' })
    expect(parseHiring(larkspur, [r('https://www.larkspurlabs.com/careers', 'Careers', 'Open roles. Current opportunities at Larkspur Labs.')], now)).not.toBeNull()
    expect(parseHiring(larkspur, [r('https://www.larkspurlabs.com/careers', 'Careers', 'We have no current vacancies, but send us your CV.')], now)).toBeNull()
    // A careers page that only invites CVs isn't hiring.
    expect(parseHiring(larkspur, [r('https://www.larkspurlabs.com/careers', 'Careers', "Send your CV and we'll be in touch when a suitable opportunity arises.")], now)).toBeNull()
  })

  it('takes a job board’s page for it with jobs counted, or one listing naming it, for a name nobody else has', () => {
    expect(parseHiring(larkspur, [r('https://uk.indeed.com/cmp/Larkspur-Labs', 'Larkspur Labs Careers and Employment', 'There are 13 jobs at Larkspur Labs. Explore them all.')], now)).toMatchObject({ label: 'Hiring · 13 open roles' })
    expect(parseHiring(larkspur, [r('https://www.glassdoor.co.uk/job-listing/engineer-larkspur-labs-JV_1.htm', 'Engineer - Larkspur Labs Ltd', 'We are looking for …')], now)).toMatchObject({ label: 'Hiring' })
    // A board's page with no count says nothing.
    expect(parseHiring(larkspur, [r('https://uk.indeed.com/cmp/Larkspur-Labs', 'Larkspur Labs Careers and Employment', 'Find out what works well at Larkspur Labs.')], now)).toBeNull()
    // Where the company's own domain doesn't fit its name, a board's page may be another company's of that name.
    expect(parseHiring({ name: 'Larkspur Labs', domain: 'lkmodels.ai' }, [r('https://www.indeed.com/cmp/Larkspur-Labs/jobs', 'Larkspur Labs Jobs', '5 jobs at Larkspur Labs')], now)).toBeNull()
  })

  it('never from LinkedIn, and nothing older than 90 days', () => {
    expect(parseHiring(larkspur, [r('https://uk.linkedin.com/company/larkspur/jobs', 'Jobs at Larkspur Labs', '12 open jobs')], now)).toBeNull()
    expect(parseHiring(larkspur, [r('https://www.larkspurlabs.com/sdr-job', 'Job Opening: SDR', 'Sep 26, 2025 — We are hiring an SDR at Larkspur Labs.')], now)).toBeNull()
  })

  it('calls a one-word, short or line-of-work name ambiguous', () => {
    expect(isAmbiguous({ name: 'Clean' })).toBe(true)
    expect(isAmbiguous({ name: 'Digital Marketing Agency' })).toBe(true)
    expect(isAmbiguous({ name: 'Larkspur Labs' })).toBe(false)
  })
})

describe('parseFunding', () => {
  const quill = { name: 'Quillmark' }

  it('takes a dated headline of the company raising, with the amount and round', () => {
    const s = parseFunding(quill, [r('https://www.example-news.com/quillmark', 'Quillmark raises €20 million Series A to build …', '6 Oct 2026 — Quillmark, a Hamburg-based platform, has raised …')], now)
    expect(s).toMatchObject({ kind: 'funding', label: 'Raised €20M Series A · Oct 2026', at: '2026-10-06' })
    expect(parseFunding(quill, [r('https://www.example.com/x', 'Quillmark secures $28m debt and equity investment', '2 days ago — UK-based Quillmark has landed …')], now)).toMatchObject({ label: 'Raised $28M · Oct 2026' })
  })

  it('reads a news site’s snippet too, not just its headline', () => {
    const s = parseFunding(quill, [r('https://www.finsmes.com/2026/10/q.html', 'Funding roundup', '4 days ago — Quillmark Raises €20M in Series A Funding. The round was led by …')], now)
    expect(s?.label).toBe('Raised €20M Series A · Oct 2026')
  })

  it('leaves out profiles, totals, old rounds, investing and other kinds of raising', () => {
    const none = (title: string, description: string, url = 'https://www.example.com/a') => expect(parseFunding(quill, [r(url, title, description)], now)).toBeNull()
    none('Quillmark - 2026 Company Profile', '7 days ago — Quillmark has raised a total funding of $91M over 2 rounds.', 'https://tracxn.com/d/companies/quillmark')
    none('Quillmark raises $5M seed round', '3 Mar 2025 — Quillmark has raised …')
    none('Quillmark invests $10M in Acme', '2 days ago — Quillmark led the round.')
    none('Quillmark raises prices for 2027', '2 days ago — Quillmark raises prices.')
    none('Quillmark plans to raise $50M', '2 days ago — Quillmark is in talks to raise.')
    none('US giant acquires Quillmark', '2 Mar 2026 — Quillmark has previously raised investment of $10.5m.')
    none('Quillmark Museum to Remain Closed Following $5M Heist', 'Aug 6, 2026 — …')
    // Someone else's news that only mentions the name's words.
    expect(parseFunding({ name: 'Global Social Media Marketing' }, [r('https://digg.com/x', 'FinT raises funding to expand its AI marketing solutions', 'Sep 18, 2026 — FinT secured funding to scale its global social media marketing business.')], now)).toBeNull()
  })

  it('needs the domain for a name others share', () => {
    const headline = r('https://www.example.com/news', 'Ultra raises $50M Series A', '7 days ago — Brooklyn-based Ultra has raised …')
    expect(parseFunding({ name: 'Ultra' }, [headline], now)).toBeNull()
    expect(parseFunding({ name: 'Ultra', domain: 'ultra.example' }, [{ ...headline, url: 'https://ultra.example/blog/series-a' }], now)).toMatchObject({ label: 'Raised $50M Series A · Oct 2026' })
  })
})
