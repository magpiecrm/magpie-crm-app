import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

// Companies, pipelines, deals and notes (server/sales/).

const id = z.string().trim().min(1).max(100)
const email = z.string().trim().toLowerCase().email().max(320)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const kind = z.enum(['open', 'won', 'lost'])

async function signedIn() {
  const { requireAuth } = await import('../auth.server')
  const session = await requireAuth()
  const { sales } = await import('../sales')
  return { sales, actor: session.email as string }
}

/* ------------------------------------------------------------- companies */

const companyInput = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  domain: z.string().trim().max(253).nullable().optional(),
  industry: z.string().trim().max(200).nullable().optional(),
  headcount: z.number().int().min(0).max(10_000_000).nullable().optional(),
  owner: email.nullable().optional(),
  notes: z.string().max(20_000).optional(),
})

export const companiesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { sales } = await signedIn()
  return sales.listCompanies()
})

export const getCompanyFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    return sales.getCompany(data.id)
  })

export const createCompanyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof companyInput> & { name: string }) => companyInput.extend({ name: z.string().trim().min(1).max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    return sales.createCompany(data)
  })

export const updateCompanyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; changes: z.input<typeof companyInput> }) => z.object({ id, changes: companyInput }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    return sales.updateCompany(data.id, data.changes)
  })

export const deleteCompanyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    sales.deleteCompany(data.id)
    return { success: true }
  })

export const setContactCompanyFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string; companyId: string | null }) => z.object({ email, companyId: id.nullable() }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    sales.setContactCompany(data.email, data.companyId)
    return { success: true }
  })

/* ------------------------------------------------------------- pipelines */

const pipelineInput = z.object({
  name: z.string().trim().min(1).max(100),
  stages: z
    .array(z.object({ id: id.optional(), name: z.string().trim().min(1).max(60), probability: z.number().min(0).max(100), kind }))
    .max(20),
})

export const pipelinesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { sales } = await signedIn()
  return { pipelines: sales.listPipelines(), owners: sales.owners() }
})

export const createPipelineFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof pipelineInput>) => pipelineInput.parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    return sales.createPipeline(data)
  })

export const updatePipelineFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string } & z.input<typeof pipelineInput>) => pipelineInput.extend({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    const { id: pipelineId, ...input } = data
    return sales.updatePipeline(pipelineId, input)
  })

export const deletePipelineFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    sales.deletePipeline(data.id)
    return { success: true }
  })

export const reorderPipelinesFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { ids: string[] }) => z.object({ ids: z.array(id).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    sales.reorderPipelines(data.ids)
    return { success: true }
  })

/* ------------------------------------------------------------- deals */

const dealFields = {
  name: z.string().trim().min(1).max(200),
  /** Pence. */
  value: z.number().int().min(0).max(1e13),
  companyId: id.nullable(),
  contactEmails: z.array(email).max(50),
  owner: email.nullable(),
  expectedClose: date.nullable(),
  lostReason: z.string().trim().max(500).nullable(),
}
const createDealInput = z.object({ ...dealFields, pipelineId: id.optional(), stageId: id.optional() }).partial().extend({ name: dealFields.name })
const updateDealInput = z.object(dealFields).partial()

export const dealsFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { pipelineId?: string; status?: 'open' | 'won' | 'lost'; owner?: string; companyId?: string; contactEmail?: string; q?: string } | undefined) =>
    z
      .object({ pipelineId: id.optional(), status: kind.optional(), owner: email.optional(), companyId: id.optional(), contactEmail: email.optional(), q: z.string().max(200).optional() })
      .optional()
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    return sales.listDeals(data)
  })

export const getDealFn = createServerFn({ method: 'GET' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    return sales.getDeal(data.id)
  })

export const createDealFn = createServerFn({ method: 'POST' })
  .inputValidator((d: z.input<typeof createDealInput>) => createDealInput.parse(d))
  .handler(async ({ data }) => {
    const { sales, actor } = await signedIn()
    return sales.createDeal(data, actor)
  })

export const updateDealFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; changes: z.input<typeof updateDealInput> }) => z.object({ id, changes: updateDealInput }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    return sales.updateDeal(data.id, data.changes)
  })

export const moveDealFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string; stageId: string; pipelineId?: string; index?: number; lostReason?: string | null }) =>
    z.object({ id, stageId: id, pipelineId: id.optional(), index: z.number().int().min(0).max(100_000).optional(), lostReason: dealFields.lostReason.optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sales, actor } = await signedIn()
    const { id: dealId, ...to } = data
    return sales.moveDeal(dealId, to, actor)
  })

export const deleteDealFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    sales.deleteDeal(data.id)
    return { success: true }
  })

/* ------------------------------------------------------------- notes */

export const addNoteFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { dealId?: string; companyId?: string; contactEmail?: string; body: string }) =>
    z.object({ dealId: id.optional(), companyId: id.optional(), contactEmail: email.optional(), body: z.string().trim().min(1).max(20_000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { sales, actor } = await signedIn()
    const { body, ...on } = data
    return sales.addNote(on, body, actor)
  })

export const deleteNoteFn = createServerFn({ method: 'POST' })
  .inputValidator((d: { id: string }) => z.object({ id }).parse(d))
  .handler(async ({ data }) => {
    const { sales } = await signedIn()
    sales.deleteNote(data.id)
    return { success: true }
  })
