import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ProspectSearch, type Contact } from '../../../features/prospects/components/ProspectSearch'

export const Route = createFileRoute('/collection/prospect-search/')({
  component: ProspectSearchPage,
})

function ProspectSearchPage() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const handleSelectionChange = (ids: Set<string>, _contacts: Contact[]) => {
    setSelectedIds(ids)
  }

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden">
      <ProspectSearch
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
      />
    </div>
  )
}
