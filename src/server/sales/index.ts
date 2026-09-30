// The sales operations the server functions (and copilot tools) call: each
// reads or changes the data through db, saving after a change. Before any of
// them, contacts are grouped into companies and the default pipeline exists.

import { db } from '../db'
import * as companies from './companies'
import * as deals from './deals'
import * as pipelines from './pipelines'
import * as tasks from './tasks'

/** Groups new contacts into companies and makes the first pipeline, saving only if that changed anything. */
function ready() {
  const grouped = companies.syncCompanies(db.data)
  const made = pipelines.ensurePipelines(db.data)
  if (grouped || made) db.mutate(() => {})
}

const read = <T>(fn: (data: typeof db.data) => T): T => {
  ready()
  return fn(db.data)
}
const write = <T>(fn: (data: typeof db.data) => T): T => {
  ready()
  return db.mutate(fn)
}

export const sales = {
  // Companies
  listCompanies: () => read(companies.listCompanies),
  getCompany: (id: string) =>
    read((data) => {
      const company = companies.listCompanies(data).find((c) => c.id === id)
      if (!company) throw new Error('Company not found')
      const contacts = data.contacts
        .filter((c) => c.company_id === id)
        .map((c) => ({ email: c.email, name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null, job_title: c.job_title || null, status: c.status }))
      return { company, contacts, deals: deals.listDeals(data, { companyId: id }), activities: deals.companyActivity(data, id) }
    }),
  createCompany: (input: companies.CompanyInput & { name: string }) => write((data) => companies.createCompany(data, input)),
  updateCompany: (id: string, input: companies.CompanyInput) => write((data) => companies.updateCompany(data, id, input)),
  deleteCompany: (id: string) => write((data) => companies.deleteCompany(data, id)),
  setContactCompany: (email: string, companyId: string | null) => write((data) => companies.setContactCompany(data, email, companyId)),

  // Pipelines
  listPipelines: () => read(pipelines.listPipelines),
  createPipeline: (input: pipelines.PipelineInput) => write((data) => pipelines.createPipeline(data, input)),
  updatePipeline: (id: string, input: pipelines.PipelineInput) => write((data) => pipelines.updatePipeline(data, id, input)),
  deletePipeline: (id: string) => write((data) => pipelines.deletePipeline(data, id)),
  reorderPipelines: (ids: string[]) => write((data) => pipelines.reorderPipelines(data, ids)),

  // Deals
  listDeals: (filters?: deals.DealFilters) => read((data) => deals.listDeals(data, filters)),
  getDeal: (id: string) => read((data) => deals.getDeal(data, id)),
  createDeal: (input: deals.DealInput, actor: string | null) => write((data) => deals.createDeal(data, input, actor)),
  updateDeal: (id: string, input: Parameters<typeof deals.updateDeal>[2]) => write((data) => deals.updateDeal(data, id, input)),
  moveDeal: (id: string, to: Parameters<typeof deals.moveDeal>[2], actor: string | null) => write((data) => deals.moveDeal(data, id, to, actor)),
  deleteDeal: (id: string) => write((data) => deals.deleteDeal(data, id)),
  addNote: (on: Parameters<typeof deals.addNote>[1], body: string, actor: string | null) => write((data) => deals.addNote(data, on, body, actor)),
  deleteNote: (id: string) => write((data) => deals.deleteNote(data, id)),

  // Tasks
  listTasks: (on?: Parameters<typeof tasks.listTasks>[1]) => read((data) => tasks.listTasks(data, on)),
  addTask: (input: tasks.TaskInput, actor: string | null) => write((data) => tasks.taskView(data, tasks.addTask(data, input, actor))),
  updateTask: (id: string, patch: Parameters<typeof tasks.updateTask>[2]) => write((data) => tasks.taskView(data, tasks.updateTask(data, id, patch))),
  deleteTask: (id: string) => write((data) => tasks.deleteTask(data, id)),
  /** Open tasks now due whose reminder hasn't gone out, marked as reminded. */
  takeDueReminders: () => write((data) => tasks.takeDueReminders(data)),

  /** The people who can own a deal. */
  owners: () => db.getUsers().map((u) => u.email),
}
