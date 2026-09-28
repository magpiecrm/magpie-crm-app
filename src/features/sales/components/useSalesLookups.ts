import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { checkAuthFn, companiesFn, contactsFn } from '../../../server/functions'

export interface ContactOption {
  email: string
  name: string | null
  company: string | null
}

/** Every contact, for the pickers. Shares the contacts page's cache. */
export function useContactOptions() {
  return useQuery({
    queryKey: queryKeys.email.contactsAll(),
    queryFn: () => contactsFn(),
    select: (data): ContactOption[] =>
      (data?.contacts ?? []).map((c: { email: string; attributes?: Record<string, string> }) => ({
        email: c.email,
        name: [c.attributes?.FIRSTNAME, c.attributes?.LASTNAME].filter(Boolean).join(' ').trim() || null,
        company: c.attributes?.COMPANY || null,
      })),
  })
}

export function useCompanies() {
  return useQuery({ queryKey: queryKeys.sales.companies(), queryFn: () => companiesFn() })
}

/** The signed-in user's email (null until known), for "Me" and default owners. */
export function useCurrentUserEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    checkAuthFn()
      .then((res) => {
        if (live && res.isAuthenticated && 'email' in res && res.email) setEmail(res.email)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return email
}

/** Refreshes everything a deal change can affect: every deals list, the deal, and company totals. */
export function useRefreshSales() {
  const queryClient = useQueryClient()
  return (dealId?: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.sales.deals() })
    queryClient.invalidateQueries({ queryKey: queryKeys.sales.companies() })
    if (dealId) queryClient.invalidateQueries({ queryKey: queryKeys.sales.deal(dealId) })
  }
}
