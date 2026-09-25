import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { queryKeys } from '../../../queryKeys'
import { getFormFn, getFormSubmissionsFn } from '../../../server/functions'
import { ArrowLeft, Users } from 'lucide-react'
import { Dialog } from '../../../components/ui/Dialog'

export const Route = createFileRoute('/marketing/forms/$formId')({
  component: FormSubmissionsPage,
})

const FIELD_LABELS: Record<string, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  email: 'Email',
  company: 'Company',
  message: 'Message',
}

/** Resolve a form field to its submitted value. Shared by the table, the mobile cards and the detail dialog. */
function getSubmissionValue(sub: any, field: string): string {
  if (field === 'email') return sub.contact_email
  if (field === 'first_name') return sub.contact?.first_name || '-'
  if (field === 'last_name') return sub.contact?.last_name || '-'
  if (field === 'company') return sub.contact?.company || '-'
  if (field === 'message') return sub.message || '-'
  return '-'
}

function FormSubmissionsPage() {
  const { formId } = Route.useParams()
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null)

  const { data: form, isLoading: formLoading } = useQuery({
    queryKey: queryKeys.email.form(formId),
    queryFn: () => getFormFn({ data: { id: formId } }),
  })

  const { data: submissions, isLoading: submissionsLoading } = useQuery({
    queryKey: queryKeys.email.formSubmissions(formId),
    queryFn: () => getFormSubmissionsFn({ data: { formId } }),
  })

  if (formLoading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="animate-pulse h-8 w-64 bg-muted rounded mb-8"></div>
        <div className="animate-pulse h-64 bg-muted rounded"></div>
      </div>
    )
  }

  if (!form) {
    return (
      <div className="p-4 lg:p-8 text-center">
        <h2 className="text-xl font-medium text-foreground mb-4">Form not found</h2>
        <Link to="/marketing/forms" className="text-accent hover:underline">
          Return to forms
        </Link>
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-8">
        <Link
          to="/marketing/forms"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Forms
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display text-foreground mb-2">
              Submissions: {form.name}
            </h1>
            <p className="text-muted-foreground">
              Total submissions: {form.submission_count}
            </p>
          </div>
        </div>
      </div>

      <div className="card border border-border rounded-md-m overflow-hidden">
        {submissionsLoading ? (
          <div className="p-4 lg:p-8 text-center text-muted-foreground text-sm">
            Loading submissions...
          </div>
        ) : !submissions || submissions.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-accent" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">No submissions yet</h3>
            <p className="text-muted-foreground text-sm">
              When people submit your form, their details will appear here.
            </p>
          </div>
        ) : (
          <>
          {/* Mobile card list — a form can define arbitrarily many columns */}
          <ul className="md:hidden divide-y divide-border">
            {submissions.map((sub, i) => (
              <li
                key={i}
                onClick={() => setSelectedSubmission(sub)}
                className="p-4 space-y-1 active:bg-muted/40 transition-colors cursor-pointer"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold text-foreground truncate">{sub.contact_email}</p>
                  <p className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(sub.submitted_at).toLocaleDateString()}
                  </p>
                </div>
                {form.fields
                  .filter(field => field !== 'email')
                  .map(field => (
                    <p key={field} className="text-xs text-muted-foreground truncate">
                      <span className="font-medium">{FIELD_LABELS[field] || field}: </span>
                      {getSubmissionValue(sub, field)}
                    </p>
                  ))}
              </li>
            ))}
          </ul>

          <table className="hidden md:table w-full text-sm text-left">
            <thead className="bg-muted text-xs text-muted-foreground border-b border-border">
              <tr>
                {form.fields.map(field => {
                  const label = FIELD_LABELS[field] || field
                  return <th key={field} className="px-6 py-3 font-medium">{label}</th>
                })}
                <th className="px-6 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {submissions.map((sub, i) => {
                return (
                  <tr
                    key={i}
                    className="hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedSubmission(sub)}
                  >
                    {form.fields.map(field => {
                      const val = getSubmissionValue(sub, field)
                      const isMessage = field === 'message'
                      return (
                        <td key={field} className={`px-6 py-4 text-muted-foreground ${isMessage ? 'max-w-[200px] truncate' : ''}`} title={isMessage ? sub.message : undefined}>
                          {field === 'email' ? <span className="font-medium text-foreground">{val}</span> : val}
                        </td>
                      )
                    })}
                    <td className="px-6 py-4 text-muted-foreground whitespace-nowrap">
                      {new Date(sub.submitted_at).toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </>
        )}
      </div>

      <Dialog
        isOpen={!!selectedSubmission}
        onClose={() => setSelectedSubmission(null)}
        title="Submission Details"
        className="max-w-lg"
      >
        {selectedSubmission && (
          <div className="p-6 space-y-4">
            {form.fields.map(field => {
              const val = getSubmissionValue(selectedSubmission, field)

              return (
                <div key={field}>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {FIELD_LABELS[field] || field}
                  </div>
                  <div className="text-sm text-foreground whitespace-pre-wrap">{val}</div>
                </div>
              )
            })}
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Submitted</div>
              <div className="text-sm text-foreground">
                {new Date(selectedSubmission.submitted_at).toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
