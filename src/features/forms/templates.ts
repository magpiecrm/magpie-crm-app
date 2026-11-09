import { Calendar, Mail, MessageSquare, Presentation, type LucideIcon } from 'lucide-react'
import { NEW_FORM, type FormDraft } from './components/FormBuilder'

/** Starting points for a new form. Each is an ordinary form once it's made. */
export const FORM_TEMPLATES: Array<{ id: string; name: string; description: string; icon: LucideIcon; draft: Partial<FormDraft> }> = [
  {
    id: 'contact',
    name: 'Contact us',
    description: 'Name, email, company and a message.',
    icon: MessageSquare,
    draft: { name: 'Contact us', fields: ['first_name', 'last_name', 'email', 'company', 'message'] },
  },
  {
    id: 'newsletter',
    name: 'Newsletter sign-up',
    description: 'First name and email, with consent.',
    icon: Mail,
    draft: {
      name: 'Newsletter sign-up',
      fields: ['first_name', 'email', 'consent'],
      submit_label: 'Subscribe',
      success_message: "You're subscribed. Look out for the next issue in your inbox.",
      welcome_email_subject: 'Welcome to the newsletter',
      welcome_email_body: "Hi {{first_name}},\n\nThanks for subscribing. You'll get the next issue as soon as it's out.\n\nBest wishes,",
    },
  },
  {
    id: 'demo',
    name: 'Demo request',
    description: 'Work details and what they want to see.',
    icon: Presentation,
    draft: {
      name: 'Demo request',
      fields: ['first_name', 'last_name', 'email', 'company', 'job_title', 'message'],
      field_settings: { message: { label: 'What would you like to see?' }, company: { required: true } },
      submit_label: 'Request a demo',
      success_message: "Thanks! We'll be in touch within one working day to find a time.",
    },
  },
  {
    id: 'event',
    name: 'Event registration',
    description: 'Who is coming, for a webinar or event.',
    icon: Calendar,
    draft: {
      name: 'Event registration',
      fields: ['first_name', 'last_name', 'email', 'company'],
      submit_label: 'Register',
      success_message: "You're registered. We'll email you the details before the day.",
      welcome_email_enabled: true,
      welcome_email_subject: "You're registered",
      welcome_email_body: "Hi {{first_name}},\n\nYou're registered. We'll send you the joining details the day before.\n\nSee you there,",
      welcome_email_delay_minutes: 0,
    },
  },
]

export function templateDraft(id: string | undefined): FormDraft {
  const t = FORM_TEMPLATES.find((x) => x.id === id)
  return t ? { ...NEW_FORM, ...t.draft } : NEW_FORM
}
