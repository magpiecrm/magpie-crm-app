import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { queryKeys } from '../../../queryKeys'
import { proposalFn, updateProposalFn } from '../../../server/functions'
import { EmailBuilder } from '../../../features/email-builder/EmailBuilderContainer'

export const Route = createFileRoute('/sales/proposals/$proposalId')({
  component: ProposalEditPage,
})

function ProposalEditPage() {
  const { proposalId } = Route.useParams()
  const { data: proposal, isLoading, error } = useQuery({
    queryKey: queryKeys.sales.proposal(proposalId),
    queryFn: () => proposalFn({ data: { id: proposalId } }),
    // The builder owns the design once open; a background refetch must not reset it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-55 bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (error || !proposal) {
    return <div className="p-8 text-destructive">{error?.message ?? 'Proposal not found'}</div>
  }
  return <ProposalEditor key={proposal.id} proposal={proposal} />
}

function ProposalEditor({ proposal }: { proposal: { id: string; deal_id: string; title: string; html: string } }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Pinned at mount, so a refetched body can't wipe the canvas.
  const [initialHtml] = useState(proposal.html)
  const close = () => navigate({ to: '/sales/deals/$id', params: { id: proposal.deal_id } })

  const save = useMutation({
    mutationFn: (html: string) => updateProposalFn({ data: { id: proposal.id, html } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sales.proposal(proposal.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sales.proposals(proposal.deal_id) })
      close()
    },
    onError: (err) => window.alert(`Could not save the proposal: ${err.message}`),
  })

  return <EmailBuilder initialHtml={initialHtml} onSave={(html) => save.mutate(html)} onClose={close} campaignName={proposal.title} />
}
