// Companies: the organisations contacts work at and deals are with.
//
// Contacts are grouped into companies by their email's domain, which is the
// one thing every contact has. Addresses at free mail providers (gmail.com,
// outlook.com …) say nothing about an employer, so those contacts are grouped
// by the company name typed on them instead, or left without a company.
// Grouping runs when companies are read, so contacts added any way (import,
// prospect search, a form) find their company without every writer knowing
// about companies; contacts already linked, or unlinked by hand, are left be.

import { randomUUID } from 'node:crypto'
import type { DbSchema } from '../db'
import type { Company, CompanyView } from '../../features/sales/types'

/** Email providers whose addresses aren't a company's. */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'pm.me', 'gmx.com', 'gmx.co.uk', 'mail.com', 'zoho.com', 'yandex.com', 'btinternet.com', 'sky.com', 'virginmedia.com',
  'talktalk.net', 'fastmail.com', 'hey.com', 'tutanota.com', 'qq.com', '163.com',
])

type Contact = DbSchema['contacts'][number]

const domainOf = (email: string) => email.split('@')[1]?.trim().toLowerCase() || null
const workDomain = (email: string) => {
  const d = domainOf(email)
  return d && !FREE_MAIL_DOMAINS.has(d) ? d : null
}
const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+(ltd|limited|plc|llc|inc|gmbh)\.?$/, '')

/** "larkspur-labs.co.uk" → "Larkspur Labs", for a company known only by its domain. */
function nameFromDomain(domain: string): string {
  const label = domain.split('.')[0] ?? domain
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

function newCompany(fields: Partial<Company> & { name: string }, now = new Date().toISOString()): Company {
  return {
    id: randomUUID(),
    domain: null,
    industry: null,
    headcount: null,
    linkedin_ref: null,
    owner: null,
    notes: '',
    created_at: now,
    updated_at: now,
    ...fields,
    name: fields.name.trim(),
  }
}

/**
 * Links contacts that have no company yet to one, creating companies as
 * needed. The first run also creates the `companies` collection. Returns
 * whether anything changed (so callers know to save).
 */
export function syncCompanies(data: DbSchema): boolean {
  let changed = !data.companies
  const companies = (data.companies ??= [])
  const byDomain = new Map(companies.filter((c) => c.domain).map((c) => [c.domain!, c]))
  const byName = new Map(companies.map((c) => [nameKey(c.name), c]))
  // Company names prospect search learnt for each domain, with staff counts.
  const prospect = new Map(data.prospect_companies?.filter((p) => p.domain).map((p) => [p.domain!.toLowerCase(), p]))

  // The name most contacts at a domain typed, so "Larkspur" beats "larkspur.com".
  const namesAt = new Map<string, Map<string, number>>()
  for (const c of data.contacts) {
    const d = workDomain(c.email)
    if (!d || !c.company?.trim()) continue
    const names = namesAt.get(d) ?? new Map<string, number>()
    names.set(c.company.trim(), (names.get(c.company.trim()) ?? 0) + 1)
    namesAt.set(d, names)
  }
  const commonName = (d: string) => [...(namesAt.get(d)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0]

  for (const contact of data.contacts as Contact[]) {
    if (contact.company_id !== undefined) continue // linked, or deliberately left without one (null)
    const d = workDomain(contact.email)
    let company: Company | undefined
    if (d) {
      company = byDomain.get(d)
      if (!company) {
        const p = prospect.get(d)
        const name = commonName(d) ?? p?.name ?? nameFromDomain(d)
        // A company made earlier from the name alone gets the domain now.
        company = byName.get(nameKey(name))
        if (company && !company.domain) company.domain = d
        else if (!company || company.domain) {
          company = newCompany({ name, domain: d, headcount: p?.headcount ?? null, linkedin_ref: p?.ref ?? null })
          companies.push(company)
          byName.set(nameKey(name), company)
        }
        byDomain.set(d, company)
      }
    } else if (contact.company?.trim()) {
      company = byName.get(nameKey(contact.company))
      if (!company) {
        company = newCompany({ name: contact.company })
        companies.push(company)
        byName.set(nameKey(company.name), company)
      }
    }
    contact.company_id = company?.id ?? null
    changed = true
  }
  return changed
}

/** Every company with its contact count and open deals, most recently changed first. */
export function listCompanies(data: DbSchema): CompanyView[] {
  const contacts = new Map<string, number>()
  for (const c of data.contacts) if (c.company_id) contacts.set(c.company_id, (contacts.get(c.company_id) ?? 0) + 1)
  const deals = new Map<string, { n: number; value: number }>()
  for (const d of data.deals ?? []) {
    if (!d.company_id || d.status !== 'open') continue
    const t = deals.get(d.company_id) ?? { n: 0, value: 0 }
    t.n++
    t.value += d.value
    deals.set(d.company_id, t)
  }
  return (data.companies ?? [])
    .map((c) => ({ ...c, contacts: contacts.get(c.id) ?? 0, open_deals: deals.get(c.id)?.n ?? 0, open_value: deals.get(c.id)?.value ?? 0 }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export type CompanyInput = Partial<Pick<Company, 'name' | 'domain' | 'industry' | 'headcount' | 'owner' | 'notes'>>

function checkOwner(data: DbSchema, owner: string | null | undefined) {
  if (owner && !data.users.some((u) => u.email === owner)) throw new Error(`${owner} isn't a user here.`)
}

function cleanDomain(domain: string | null | undefined): string | null {
  if (!domain) return null
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  return d || null
}

export function createCompany(data: DbSchema, input: CompanyInput & { name: string }): Company {
  checkOwner(data, input.owner)
  const domain = cleanDomain(input.domain)
  if (domain && data.companies?.some((c) => c.domain === domain)) throw new Error(`A company with the domain ${domain} already exists.`)
  const company = newCompany({ ...input, domain })
  ;(data.companies ??= []).push(company)
  // Contacts at the domain who have no company yet join it.
  if (domain) for (const c of data.contacts) if (!c.company_id && workDomain(c.email) === domain) c.company_id = company.id
  return company
}

export function updateCompany(data: DbSchema, id: string, input: CompanyInput): Company {
  const company = data.companies?.find((c) => c.id === id)
  if (!company) throw new Error('Company not found')
  checkOwner(data, input.owner)
  const domain = input.domain === undefined ? company.domain : cleanDomain(input.domain)
  if (domain && domain !== company.domain && data.companies?.some((c) => c.domain === domain)) {
    throw new Error(`A company with the domain ${domain} already exists.`)
  }
  Object.assign(company, { ...input, domain, name: (input.name ?? company.name).trim(), updated_at: new Date().toISOString() })
  return company
}

/** Deletes the company; its contacts and deals stay, without a company. */
export function deleteCompany(data: DbSchema, id: string) {
  data.companies = (data.companies ?? []).filter((c) => c.id !== id)
  // null, not undefined: a deliberate "no company", so grouping won't make it again.
  for (const c of data.contacts) if (c.company_id === id) c.company_id = null
  for (const d of data.deals ?? []) if (d.company_id === id) d.company_id = null
}

/** Moves a contact to another company, or to none. */
export function setContactCompany(data: DbSchema, email: string, companyId: string | null) {
  const contact = data.contacts.find((c) => c.email === email.toLowerCase().trim())
  if (!contact) throw new Error('Contact not found')
  if (companyId && !data.companies?.some((c) => c.id === companyId)) throw new Error('Company not found')
  contact.company_id = companyId
}
