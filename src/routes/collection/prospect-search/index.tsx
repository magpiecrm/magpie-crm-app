import { createFileRoute } from '@tanstack/react-router'
import { ProspectSearch } from '../../../features/prospects/components/ProspectSearch'

export const Route = createFileRoute('/collection/prospect-search/')({
  component: ProspectSearchPage,
})

function ProspectSearchPage() {
  return (
    <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden">
      <ProspectSearch />
    </div>
  )
}
