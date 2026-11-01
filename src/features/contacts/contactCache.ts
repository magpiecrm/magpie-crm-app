import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import type { ContactCustomValue } from './contactFields'

/**
 * Puts a contact's new custom values into whatever's on screen. Refetching
 * would reload every contact to change one cell, so edits never invalidate.
 */
export function patchContactCustom(queryClient: QueryClient, email: string, custom: Record<string, ContactCustomValue>) {
  const inPage = (old: any) => (old?.contacts ? { ...old, contacts: old.contacts.map((c: any) => (c.email === email ? { ...c, custom } : c)) } : old)
  queryClient.setQueriesData({ queryKey: queryKeys.email.contacts() }, inPage)
  // That prefix also holds things that aren't contacts.
  queryClient.setQueriesData({ queryKey: queryKeys.email.listPages(), predicate: (q) => q.queryKey[3] === 'contacts' }, inPage)
  queryClient.setQueryData(queryKeys.email.contact(email), (old: any) => (old?.contact ? { ...old, contact: { ...old.contact, custom } } : old))
}

/** After a field changes: everything that lists the fields. A deleted one is gone from contacts too. */
export function invalidateContactFields(queryClient: QueryClient) {
  for (const queryKey of [queryKeys.email.contactFields(), queryKeys.email.listFilterFields(), queryKeys.email.contactColumns(), queryKeys.email.contactDetails()]) {
    queryClient.invalidateQueries({ queryKey })
  }
}
