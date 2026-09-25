import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { queryKeys } from '../../../../queryKeys'
import { getTemplateFn, updateTemplateFn } from '../../../../server/functions'
import { EmailBuilder } from '../../../../features/email-builder/EmailBuilderContainer'
import type { EmailTemplate } from '../../../../features/templates/types'

export const Route = createFileRoute('/marketing/templates/$templateId/edit')({
  component: TemplateEditPage,
})

function TemplateEditPage() {
  const { templateId } = Route.useParams()

  const { data: template, isLoading, error } = useQuery({
    queryKey: queryKeys.templates.template(templateId),
    queryFn: () => getTemplateFn({ data: { id: templateId } }),
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
  if (error || !template) {
    return <div className="p-8 text-destructive">{error?.message ?? 'Template not found'}</div>
  }

  return <TemplateEditor key={template.id} template={template} />
}

function TemplateEditor({ template }: { template: EmailTemplate }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Pinned at mount. Copilot template tools invalidate the `templates` keys,
  // and a refetched body flowing into `initialHtml` would wipe the canvas.
  const [initialHtml] = useState(template.html)
  const [meta] = useState(() => ({ id: template.id, name: template.name }))

  const close = () => navigate({ to: '/marketing/templates' })

  const save = useMutation({
    mutationFn: (html: string) => updateTemplateFn({ data: { id: template.id, html } }),
    onSuccess: saved => {
      queryClient.setQueryData(queryKeys.templates.template(template.id), saved)
      queryClient.invalidateQueries({ queryKey: queryKeys.templates.list(), exact: true })
      close()
    },
    onError: err => window.alert(`Could not save the template: ${err.message}`),
  })

  return (
    <EmailBuilder
      initialHtml={initialHtml}
      onSave={html => save.mutate(html)}
      onClose={close}
      campaignName={template.name}
      template={meta}
    />
  )
}
