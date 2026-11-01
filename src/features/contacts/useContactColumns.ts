import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { getContactColumnsFn, getContactFieldsFn } from '../../server/functions'
import { visibleColumns } from './contactColumns'
import type { ContactTableView } from './contactFields'

/** The custom fields, and the columns a table shows for this workspace. */
export function useContactColumns(view: ContactTableView) {
  const { data: fields = [] } = useQuery({ queryKey: queryKeys.email.contactFields(), queryFn: () => getContactFieldsFn() })
  const { data: saved } = useQuery({ queryKey: queryKeys.email.contactColumns(), queryFn: () => getContactColumnsFn() })
  return { fields, columns: visibleColumns(view, saved?.[view], fields) }
}
