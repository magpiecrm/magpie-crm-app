/**
 * Sales records: companies, pipelines, deals and their activity. Shared by
 * the server (stored in db.ts, handled in server/sales/) and the pages.
 */

export interface Company {
  id: string
  name: string
  /** Its email domain, e.g. `larkspur.com`. Contacts with addresses there belong to it. */
  domain: string | null
  industry: string | null
  /** Staff count, when known (from prospect search). */
  headcount: number | null
  /** LinkedIn company ref from prospect search, when it came from there. */
  linkedin_ref: string | null
  /** A user's email. */
  owner: string | null
  notes: string
  created_at: string
  updated_at: string
}

export type StageKind = 'open' | 'won' | 'lost'

export interface PipelineStage {
  id: string
  name: string
  /** Chance an open deal here is won, 0-100, for the weighted forecast. Won is 100, lost 0. */
  probability: number
  kind: StageKind
}

export interface Pipeline {
  id: string
  name: string
  /** In board order: open stages, then one won and one lost stage. */
  stages: PipelineStage[]
  /** Order among pipelines; the first is the default. */
  position: number
  created_at: string
  updated_at: string
}

export type DealStatus = StageKind

export interface Deal {
  id: string
  name: string
  pipeline_id: string
  stage_id: string
  /** In minor units (pence), so sums stay exact. */
  value: number
  currency: 'GBP'
  company_id: string | null
  contact_emails: string[]
  /** A user's email. */
  owner: string | null
  /** YYYY-MM-DD */
  expected_close: string | null
  /** Follows the stage's kind. */
  status: DealStatus
  lost_reason: string | null
  /** Order within its stage on the board. */
  position: number
  stage_entered_at: string
  closed_at: string | null
  created_at: string
  updated_at: string
}

type ActivityKind = 'note' | 'task' | 'created' | 'stage_change' | 'proposal'

/** Something that happened to a deal, company or contact; notes and tasks are written by people. */
export interface Activity {
  id: string
  kind: ActivityKind
  deal_id: string | null
  company_id: string | null
  contact_email: string | null
  body: string
  /** `stage_change`: the stage names at the time. */
  from_stage?: string
  to_stage?: string
  /** `task`: when it's due, when it was done, and when its reminder went out (tasks.ts). */
  due_at?: string | null
  done_at?: string | null
  reminded_at?: string | null
  /** The user who did it, when a person did. */
  created_by: string | null
  created_at: string
}

/** A deal as the pages show it: its record plus the names they need. */
export interface DealView extends Deal {
  stage_name: string
  pipeline_name: string
  company_name: string | null
  contacts: Array<{ email: string; name: string | null }>
}

export interface CompanyView extends Company {
  contacts: number
  open_deals: number
  /** Minor units. */
  open_value: number
}

/** Pence to a display amount, e.g. 125000 → "£1,250". */
export function formatMoney(minor: number, currency: Deal['currency'] = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100)
}

/**
 * A proposal for a deal: a page designed in the email builder, shared as a
 * private link (/p/<token>) that shows when it's opened and can be accepted.
 */
export interface Proposal {
  id: string
  deal_id: string
  /** The link's secret part. */
  token: string
  title: string
  /** The builder's compiled HTML, with its design embedded. */
  html: string
  /** When it was first sent or its link copied; null while a draft. */
  sent_at: string | null
  /** Opens by people, not counting the team's own previews or scanners. */
  views: number
  first_viewed_at: string | null
  last_viewed_at: string | null
  /** Opens by link scanners and previewers (Slack, Outlook Safe Links and the like). */
  bot_views: number
  accepted_at: string | null
  /** The name they typed to accept it. */
  accepted_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** A proposal as the deal page lists it: without its HTML, with its link. */
export type ProposalSummary = Omit<Proposal, 'html' | 'token'> & { url: string }
