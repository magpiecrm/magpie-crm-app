import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Field, FieldGrid } from '../../../components/ui/Field'
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
    <Dialog isOpen={isOpen} onClose={close} title="New company" className="sm:max-w-md">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <DialogBody className="space-y-4">
          <Field label="Name">
            <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Larkspur Labs" className={FIELD_CLASS} />
          </Field>
          <Field label="Website domain" hint="Contacts with email addresses here join the company.">
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. larkspur.com" className={FIELD_CLASS} />
          </Field>
          <FieldGrid>
            <Field label="Industry">
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Software" className={FIELD_CLASS} />
            </Field>
            <Field label="Staff">
              <input inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value)} placeholder="e.g. 50" className={FIELD_CLASS} />
            </Field>
          </FieldGrid>
          <Field label="Owner">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)} className={FIELD_CLASS}>
              <option value="">No owner</option>
              {(sales?.owners ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          {create.error && <p className="text-[13px] text-destructive sm:mr-auto">{create.error.message}</p>}
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" isLoading={create.isPending}>
            Add company
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
