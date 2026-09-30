import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createDealFn } from '../../../server/functions'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { FIELD_CLASS } from '../forms'
import { usePipelines } from '../usePipelines'
import type { DealView } from '../types'
import { openStages, poundsToPence } from '../utils'
import { CompanyPicker } from './CompanyPicker'
import { ContactPicker } from './ContactPicker'
import { useCurrentUserEmail, useRefreshSales } from './useSalesLookups'
import { Select } from '../../../components/ui/Select'

export interface DealFormInitial {
  pipelineId?: string
  stageId?: string
  companyId?: string | null
  contactEmails?: string[]
}

const LABEL = 'block text-xs font-medium text-muted-foreground mb-1.5'

/** The "New deal" dialog, used by the board, the deals list and (through the board's URL) the company page. */
export function DealForm({
  isOpen,
  onClose,
  initial,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  initial?: DealFormInitial
  onCreated?: (deal: DealView) => void
}) {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="New deal" className="max-w-lg">
      {/* Mounted only while open, so each opening starts from `initial`. */}
      {isOpen && <DealFormBody initial={initial} onClose={onClose} onCreated={onCreated} />}
    </Dialog>
  )
}

function DealFormBody({ initial, onClose, onCreated }: { initial?: DealFormInitial; onClose: () => void; onCreated?: (deal: DealView) => void }) {
  const { data } = usePipelines()
  const pipelines = data?.pipelines ?? []
  const owners = data?.owners ?? []
  const me = useCurrentUserEmail()
  const refresh = useRefreshSales()

  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [pipelineId, setPipelineId] = useState(initial?.pipelineId ?? '')
  const [stageId, setStageId] = useState(initial?.stageId ?? '')
  const [companyId, setCompanyId] = useState<string | null>(initial?.companyId ?? null)
  const [contactEmails, setContactEmails] = useState<string[]>(initial?.contactEmails ?? [])
  // `undefined` leaves it to the server, which makes the signed-in user the owner.
  const [owner, setOwner] = useState<string | null | undefined>(undefined)
  const [expectedClose, setExpectedClose] = useState('')

  // Fill in the pipeline and its first stage once the pipelines have loaded.
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0]
  const stages = useMemo(() => (pipeline ? openStages(pipeline) : []), [pipeline])
  useEffect(() => {
    if (!pipeline) return
    if (pipeline.id !== pipelineId) setPipelineId(pipeline.id)
    if (!stages.some((s) => s.id === stageId)) setStageId(stages[0]?.id ?? '')
  }, [pipeline, pipelineId, stageId, stages])

  const pence = poundsToPence(value)
  const create = useMutation({
    mutationFn: () =>
      createDealFn({
        data: {
          name: name.trim(),
          value: pence ?? 0,
          pipelineId: pipeline?.id,
          stageId: stageId || undefined,
          companyId,
          contactEmails,
          owner,
          expectedClose: expectedClose || null,
        },
      }),
    onSuccess: (deal) => {
      refresh()
      onCreated?.(deal)
      onClose()
    },
  })

  const ownerValue = owner === undefined ? (me ?? '') : (owner ?? '')

  return (
    <form
      className="flex flex-col min-h-0"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() && pence !== null) create.mutate()
      }}
    >
      <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
        <div>
          <label htmlFor="deal-name" className={LABEL}>
            Name
          </label>
          <input
            id="deal-name"
            autoFocus
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="For example: Larkspur annual plan"
            className={FIELD_CLASS}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="deal-value" className={LABEL}>
              Value
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">£</span>
              <input
                id="deal-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                aria-invalid={pence === null}
                className={`${FIELD_CLASS} pl-7`}
              />
            </div>
            {pence === null && <p className="text-xs text-destructive mt-1">Enter an amount in pounds.</p>}
          </div>
          <div>
            <label htmlFor="deal-close" className={LABEL}>
              Expected close
            </label>
            <input id="deal-close" type="date" value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} className={FIELD_CLASS} />
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-4 ${pipelines.length > 1 ? 'sm:grid-cols-2' : ''}`}>
          {pipelines.length > 1 && (
            <div>
              <label htmlFor="deal-pipeline" className={LABEL}>
                Pipeline
              </label>
              <Select id="deal-pipeline" value={pipeline?.id ?? ''} onChange={(e) => setPipelineId(e.target.value)} className={FIELD_CLASS}>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <label htmlFor="deal-stage" className={LABEL}>
              Stage
            </label>
            <Select id="deal-stage" value={stageId} onChange={(e) => setStageId(e.target.value)} className={FIELD_CLASS}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <span className={LABEL}>Company</span>
          <CompanyPicker value={companyId} onChange={setCompanyId} />
        </div>

        <div>
          <span className={LABEL}>People</span>
          <ContactPicker value={contactEmails} onChange={setContactEmails} />
        </div>

        <div>
          <label htmlFor="deal-owner" className={LABEL}>
            Owner
          </label>
          <Select
            id="deal-owner"
            value={ownerValue}
            onChange={(e) => setOwner(e.target.value || null)}
            className={FIELD_CLASS}
          >
            <option value="">No owner</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o === me ? `${o} (you)` : o}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 border-t border-border bg-card flex items-center justify-end gap-2 shrink-0">
        {create.error && <p className="text-xs text-destructive mr-auto">{create.error.message}</p>}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" isLoading={create.isPending} disabled={!name.trim() || pence === null}>
          Create deal
        </Button>
      </div>
    </form>
  )
}
