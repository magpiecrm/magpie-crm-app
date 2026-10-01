import { Link } from '@tanstack/react-router'
import { CheckCircle2, ClipboardCheck, ClipboardList, FileText, History, MailOpen, MessageSquareReply, MousePointerClick, Send } from 'lucide-react'
import type { ContactActivity } from '../../../server/contactActivity'

const ICONS: Record<ContactActivity['type'], typeof Send> = {
  campaign_sent: Send,
  campaign_opened: MailOpen,
  campaign_clicked: MousePointerClick,
  sequence_sent: Send,
  sequence_opened: MailOpen,
  sequence_clicked: MousePointerClick,
  sequence_replied: MessageSquareReply,
  form_submitted: FileText,
  survey_started: ClipboardList,
  survey_completed: ClipboardCheck,
}

export function ContactHistoryTab({ activity }: { activity: ContactActivity[] }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <History className="w-5 h-5 text-accent" />
        <h3 className="font-bold text-foreground">Timeline</h3>
      </div>
      {activity.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">No activity yet.</div>
      ) : (
        <div className="relative border-l border-border pl-6 space-y-5 my-2">
          {activity.map((event, i) => {
            const Icon = ICONS[event.type] ?? CheckCircle2
            return (
              <div key={i} className="relative">
                <div className="absolute -left-[31px] top-0.5 bg-accent text-accent-foreground rounded-full p-1 border-4 border-card">
                  <Icon className="w-3.5 h-3.5" />
                </div>
                {event.url ? (
                  <Link to={event.url} className="text-sm font-semibold text-foreground hover:text-accent">
                    {event.label}
                  </Link>
                ) : (
                  <p className="text-sm font-semibold text-foreground">{event.label}</p>
                )}
                <p className="text-[11px] font-mono text-muted-foreground/70 mt-0.5">{new Date(event.at).toLocaleString()}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
