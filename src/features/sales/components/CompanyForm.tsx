import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '../../../components/ui/Dialog'
import { Button } from '../../../components/ui/Button'
import { createCompanyFn } from '../../../server/functions'
import { queryKeys } from '../../../queryKeys'
import { usePipelines } from '../usePipelines'
import type { Company } from '../types'
import { FIELD_CLASS, parseHeadcount } from '../forms'
import { Select } from '../../../components/ui/Select'

/**
 * A dialog for adding a company by hand. Most companies are made from
 * contacts' work email domains, so this is for the ones that aren't.
 */
export function CompanyForm({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  onCreated?: (company: Company) => void
}) {
  const queryClient = useQueryClient()
  const { data: sales } = usePipelines()
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [industry, setIndustry] = useState('')
  const [headcount, setHeadcount] = useState('')
  const [owner, setOwner] = useState('')

  const reset = () => {
    setName('')
    setDomain('')
    setIndustry('')
    setHeadcount('')
    setOwner('')
  }

  const create = useMutation({
    mutationFn: () =>
      createCompanyFn({
        data: {
          name: name.trim(),
          domain: domain.trim() || null,
          industry: industry.trim() || null,
          headcount: parseHeadcount(headcount),
          owner: owner || null,
        },
      }),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sales.companies() })
      reset()
      create.reset()
      onClose()
      onCreated?.(company)
    },
  })

  const close = () => {
    create.reset()
    onClose()
  }

  return (
    <Dialog isOpen={isOpen} onClose={close} title="New company" className="max-w-md">
      <form
        className="p-6 space-y-4 overflow-y-auto"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Larkspur Labs" className={FIELD_CLASS} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Website domain</span>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="larkspur.com" className={FIELD_CLASS} />
          <span className="block text-xs text-muted-foreground">Contacts with email addresses here join the company.</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Industry</span>
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Software" className={FIELD_CLASS} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Staff</span>
            <input
              inputMode="numeric"
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
              placeholder="50"
              className={FIELD_CLASS}
            />
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Owner</span>
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} className={FIELD_CLASS}>
            <option value="">No owner</option>
            {(sales?.owners ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </label>
        {create.error && <p className="text-xs text-destructive">{create.error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm" isLoading={create.isPending} disabled={!name.trim()}>
            Add company
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
