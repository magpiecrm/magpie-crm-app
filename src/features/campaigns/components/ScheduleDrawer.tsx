import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { queryKeys } from '../../../queryKeys'
import { X, HelpCircle, AlertCircle, Info } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { sendCampaignFn, unconfirmedInListFn, updateCampaignFn } from '../../../server/functions'
import { BATCH_WAITS, everyText } from '../batches'
import { sentMessage } from '../sendResult'

interface ScheduleDrawerProps {
  isOpen: boolean
  onClose: () => void
  campaignId: number
  campaignData: {
    name: string
    subject: string
    previewText?: string
    senderName: string
    senderEmail: string
    senderId: number | null
    htmlContent: string
    selectedListId: number | null
    unsubscribeEnabled: boolean
    trackOpens: boolean
  }
  onSendSuccess?: () => void
}

type SendOption = 'now' | 'later' | 'batches'

const hours = (h: number) => (h === 1 ? 'an hour' : `${h} hours`)
const pct = (rate: number) => `${+(rate * 100).toFixed(1)}%`

export function ScheduleDrawer({ isOpen, onClose, campaignId, campaignData, onSendSuccess }: ScheduleDrawerProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selectedOption, setSelectedOption] = useState<SendOption>('now')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [batchSize, setBatchSize] = useState('100')
  const [batchWait, setBatchWait] = useState(60)
  const [batchStart, setBatchStart] = useState<'now' | 'later'>('now')
  const listId = campaignData.selectedListId
  const { data: unconfirmed } = useQuery({
    queryKey: queryKeys.email.listUnconfirmed(listId ?? 0),
    queryFn: () => unconfirmedInListFn({ data: { listId: listId! } }),
    enabled: isOpen && listId != null,
  })

  // Reset states when opening
  useEffect(() => {
    if (isOpen) {
      setSelectedOption('now')
      setScheduleDate('')
      setScheduleTime('')
      setErrorMsg('')
      setBatchStart('now')
    }
  }, [isOpen])

  // Prevent background scroll
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalOverflow
      }
    }
  }, [isOpen])

  type Batches = { size: number; everyMinutes: number } | null

  // The campaign as the wizard has it now, so what's sent or scheduled is the current draft.
  const save = (extra: { scheduledAt?: string; batches: Batches }) =>
    updateCampaignFn({
      data: {
        id: campaignId,
        name: campaignData.name,
        subject: campaignData.subject,
        previewText: campaignData.previewText,
        sender: {
          name: campaignData.senderName,
          email: campaignData.senderEmail,
          id: campaignData.senderId || undefined,
        },
        htmlContent: campaignData.htmlContent,
        recipients: { listIds: campaignData.selectedListId ? [campaignData.selectedListId] : [] },
        // The form's switches too: without them a change made just before sending was lost.
        unsubscribeEnabled: campaignData.unsubscribeEnabled,
        trackOpens: campaignData.trackOpens,
        ...extra,
      },
    })

  const done = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.email.campaigns() })
    onClose()
    if (onSendSuccess) {
      onSendSuccess()
    } else {
      navigate({ to: '/marketing/campaigns' })
    }
  }

  const sendMutation = useMutation({
    // All at once, or its first batch now with the rest following by themselves.
    mutationFn: async (batches: Batches) => {
      await save({ batches })
      return sendCampaignFn({ data: { id: campaignId } })
    },
    onSuccess: (res: any) => {
      alert(sentMessage(res))
      done()
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to send campaign')
    }
  })

  const scheduleMutation = useMutation({
    mutationFn: async (plan: { scheduledAt: string; batches: Batches }) => save(plan),
    onSuccess: (_res, plan) => {
      alert(plan.batches ? `Campaign scheduled: ${plan.batches.size} ${everyText(plan.batches.everyMinutes)} from then.` : 'Campaign scheduled successfully!')
      done()
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to schedule campaign')
    }
  })

  if (!isOpen) return null

  const missingFields = []
  if (!campaignData.name) missingFields.push('Campaign Name')
  if (!campaignData.senderEmail) missingFields.push('Sender Profile')
  if (!campaignData.subject) missingFields.push('Subject Line')
  if (!campaignData.selectedListId) missingFields.push('Recipients List')
  if (!campaignData.htmlContent) missingFields.push('Design Content')

  const isCampaignInvalid = missingFields.length > 0

  /** The date and time picked, as an ISO string, or null after saying what's wrong with them. */
  const pickedTime = (): string | null => {
    if (!scheduleDate || !scheduleTime) {
      setErrorMsg('Please select a date and time to schedule.')
      return null
    }
    const combinedDateTime = new Date(`${scheduleDate}T${scheduleTime}`)
    if (isNaN(combinedDateTime.getTime())) {
      setErrorMsg('Invalid date or time selected.')
      return null
    }
    if (combinedDateTime.getTime() <= Date.now()) {
      setErrorMsg('Schedule time must be in the future.')
      return null
    }
    return combinedDateTime.toISOString()
  }

  const startsLater = selectedOption === 'later' || (selectedOption === 'batches' && batchStart === 'later')

  const handleConfirm = () => {
    if (isCampaignInvalid) return
    setErrorMsg('')
    let batches: Batches = null
    if (selectedOption === 'batches') {
      const size = Number(batchSize)
      if (!Number.isInteger(size) || size < 1) {
        setErrorMsg('Enter how many emails go in each batch.')
        return
      }
      batches = { size, everyMinutes: batchWait }
    }
    if (startsLater) {
      const scheduledAt = pickedTime()
      if (scheduledAt) scheduleMutation.mutate({ scheduledAt, batches })
    } else {
      sendMutation.mutate(batches)
    }
  }

  const isPending = sendMutation.isPending || scheduleMutation.isPending
  const isScheduleDisabled = startsLater && (!scheduleDate || !scheduleTime)
  const INPUT = 'w-full px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:ring-1 focus:ring-accent outline-none'
  const SMALL_LABEL = 'block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5'
  const dateAndTime = (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label htmlFor="schedule-date" className={SMALL_LABEL}>Date</label>
        <input
          id="schedule-date"
          type="date"
          value={scheduleDate}
          onChange={(e) => setScheduleDate(e.target.value)}
          min={new Date().toISOString().split('T')[0]}
          className={INPUT}
        />
      </div>
      <div>
        <label htmlFor="schedule-time" className={SMALL_LABEL}>Time</label>
        <input id="schedule-time" type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className={INPUT} />
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 overflow-hidden font-sans">
      {/* Backdrop overlay */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300 animate-in fade-in"
        onClick={onClose} 
      />

      {/* Drawer Container */}
      <div className="absolute right-0 top-0 h-full w-full sm:w-[460px] bg-card border-l border-border shadow-2xl flex flex-col z-10 transition-transform duration-300 animate-in slide-in-from-right">
        
        {/* Header */}
        <div className="px-6 py-5 bg-emerald-500/10 dark:bg-emerald-950/20 border-b border-emerald-500/15 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-foreground">Schedule</h3>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose} 
            className="text-muted-foreground hover:text-foreground rounded-full"
            aria-label="Close schedule drawer"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {isCampaignInvalid && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-200 text-xs rounded-xl flex gap-3 items-start animate-in fade-in duration-200">
              <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <h5 className="font-bold text-sm text-amber-900 dark:text-amber-100">Setup Required Before Send</h5>
                <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/90 leading-normal">
                  Please complete the following checklist steps in the editor wizard before sending or scheduling this campaign:
                </p>
                <ul className="list-disc pl-4 mt-2 space-y-1 font-semibold text-xs text-amber-900 dark:text-amber-200">
                  {missingFields.map(field => <li key={field}>{field}</li>)}
                </ul>
              </div>
            </div>
          )}
          {unconfirmed && unconfirmed.unconfirmed > 0 && (
            <div className="p-4 bg-muted/40 border border-border text-xs rounded-xl flex gap-3 items-start">
              <Info className="w-5 h-5 shrink-0 text-muted-foreground mt-0.5" />
              <p className="text-muted-foreground leading-normal">
                <span className="font-semibold text-foreground">
                  {unconfirmed.unconfirmed} of {unconfirmed.total} recipients have unverified addresses
                </span>{' '}
                (at companies whose mail server accepts every address, or that couldn't be checked).
                {unconfirmed.unconfirmed > unconfirmed.firstBatch
                  ? ` The first ${unconfirmed.firstBatch} go out with everyone else; the rest follow at least ${hours(unconfirmed.holdHours)} later, once their bounces are in, unless more than ${pct(unconfirmed.maxBounceRate)} of those bounce.`
                  : ' Some may bounce.'}
              </p>
            </div>
          )}
          <div>
            <h4 className="text-base font-bold text-foreground">When would you like to send the campaign?</h4>
          </div>

          {/* Options List */}
          <div className="space-y-4">
            
            {/* Option 1: Send now */}
            <label className={`flex items-start gap-3.5 p-4 rounded-xl border transition-all cursor-pointer ${
              selectedOption === 'now' 
                ? 'bg-accent/5 border-accent ring-1 ring-accent' 
                : 'bg-muted/10 border-border hover:bg-muted/20'
            }`}>
              <input
                type="radio"
                name="send-option"
                checked={selectedOption === 'now'}
                onChange={() => setSelectedOption('now')}
                className="mt-1 w-4 h-4 text-accent border-border focus:ring-accent accent-accent shrink-0"
              />
              <div className="flex-1">
                <span className="font-bold text-sm text-foreground">Send now</span>
              </div>
            </label>

            {/* Option 2: Schedule for later */}
            <div className={`rounded-xl border transition-all ${
              selectedOption === 'later' 
                ? 'bg-accent/5 border-accent ring-1 ring-accent' 
                : 'bg-muted/10 border-border hover:bg-muted/20'
            }`}>
              <label className="flex items-start gap-3.5 p-4 cursor-pointer">
                <input
                  type="radio"
                  name="send-option"
                  checked={selectedOption === 'later'}
                  onChange={() => setSelectedOption('later')}
                  className="mt-1 w-4 h-4 text-accent border-border focus:ring-accent accent-accent shrink-0"
                />
                <div className="flex-1">
                  <span className="font-bold text-sm text-foreground">Schedule for later</span>
                </div>
              </label>

              {/* Expansible Date-Time Picker if "later" selected */}
              {selectedOption === 'later' && (
                <div className="px-4 pb-4 pt-1 border-t border-border/40 space-y-3.5 animate-in fade-in duration-200">
                  {dateAndTime}
                </div>
              )}
            </div>

            {/* Option 3: Send in batches */}
            <div className={`rounded-xl border transition-all ${
              selectedOption === 'batches'
                ? 'bg-accent/5 border-accent ring-1 ring-accent'
                : 'bg-muted/10 border-border hover:bg-muted/20'
            }`}>
              <label className="flex items-start gap-3.5 p-4 cursor-pointer">
                <input
                  type="radio"
                  name="send-option"
                  checked={selectedOption === 'batches'}
                  onChange={() => setSelectedOption('batches')}
                  className="mt-1 w-4 h-4 text-accent border-border focus:ring-accent accent-accent shrink-0"
                />
                <div className="flex-1 flex items-center gap-2">
                  <span className="font-bold text-sm text-foreground">Send in batches</span>
                  <span title="Sends to a set number of recipients at a time, with a wait between, instead of everyone at once.">
                    <HelpCircle className="w-4 h-4 text-muted-foreground/60" />
                  </span>
                </div>
              </label>

              {selectedOption === 'batches' && (
                <div className="px-4 pb-4 pt-1 border-t border-border/40 space-y-3.5 animate-in fade-in duration-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="batch-size" className={SMALL_LABEL}>Emails per batch</label>
                      <input
                        id="batch-size"
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={batchSize}
                        onChange={(e) => setBatchSize(e.target.value)}
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label htmlFor="batch-wait" className={SMALL_LABEL}>Wait between batches</label>
                      <select id="batch-wait" value={batchWait} onChange={(e) => setBatchWait(Number(e.target.value))} className={INPUT}>
                        {BATCH_WAITS.map((w) => (
                          <option key={w.minutes} value={w.minutes}>{w.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="batch-start" className={SMALL_LABEL}>First batch</label>
                    <select id="batch-start" value={batchStart} onChange={(e) => setBatchStart(e.target.value as 'now' | 'later')} className={INPUT}>
                      <option value="now">Goes now</option>
                      <option value="later">Goes at a time I choose</option>
                    </select>
                  </div>
                  {batchStart === 'later' && dateAndTime}
                  <p className="text-xs text-muted-foreground leading-normal">
                    {unconfirmed && Number(batchSize) >= 1
                      ? unconfirmed.total <= Number(batchSize)
                        ? `All ${unconfirmed.total} recipients fit in one batch. `
                        : `${unconfirmed.total} recipients in ${Math.ceil(unconfirmed.total / Number(batchSize))} batches, ${everyText(batchWait)}. `
                      : ''}
                    The batches carry on by themselves. Taking the campaign off the schedule stops the rest.
                  </p>
                </div>
              )}
            </div>

            {/* Option 4: Send at best time (not built yet) */}
            <div className="flex items-start gap-3.5 p-4 rounded-xl border bg-muted/5 border-border/60 opacity-80">
              <input
                type="radio"
                name="send-option"
                disabled
                aria-label="Send at best time (coming soon)"
                className="mt-1 w-4 h-4 text-muted-foreground border-border/40 shrink-0 cursor-not-allowed"
              />
              <div className="flex-1 flex flex-wrap items-center gap-2">
                <span className="font-bold text-sm text-muted-foreground">Send at best time</span>
                <span title="Sends to each recipient at the time they're most likely to open.">
                  <HelpCircle className="w-4 h-4 text-muted-foreground/60" />
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground border border-border">
                  Coming soon
                </span>
              </div>
            </div>

          </div>

          {/* Error Message Display */}
          {errorMsg && (
            <div className="p-3.5 bg-destructive/10 border border-destructive/25 text-destructive text-xs rounded-xl flex gap-2.5 items-start">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer actions panel */}
        <div className="px-6 py-4 border-t border-border bg-muted/15 flex justify-end shrink-0">
          <Button
            onClick={handleConfirm}
            disabled={isScheduleDisabled || isPending || isCampaignInvalid}
            isLoading={isPending}
            className="px-6"
          >
            {startsLater ? 'Schedule' : selectedOption === 'batches' ? 'Send first batch' : 'Send now'}
          </Button>
        </div>

      </div>
    </div>
  )
}
