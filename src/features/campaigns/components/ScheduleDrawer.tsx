import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { queryKeys } from '../../../queryKeys'
import { Button } from '../../../components/ui/Button'
import { Dialog, DialogBody, DialogFooter } from '../../../components/ui/Dialog'
import { Field, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { toast } from '../../../components/ui/toast'
import { Select } from '../../../components/ui/Select'
import { sendCampaignFn, unconfirmedInListFn, updateCampaignFn } from '../../../server/functions'
import { BATCH_WAITS, everyText } from '../batches'
import { sentMessage, toastParts } from '../sendResult'
import { SpamScoreCard, confirmSpamRisk } from '../../spam-score/SpamScoreCard'
import { useCampaignSpamScore } from '../../spam-score/useSpamScore'

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
  /** "Fix with AI" on the spam score: saves the draft and asks the copilot. */
  onFixWithAI?: () => void
}

type SendOption = 'now' | 'later' | 'batches'

const hours = (h: number) => (h === 1 ? 'an hour' : `${h} hours`)
const pct = (rate: number) => `${+(rate * 100).toFixed(1)}%`

export function ScheduleDrawer({ isOpen, onClose, campaignId, campaignData, onSendSuccess, onFixWithAI }: ScheduleDrawerProps) {
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
  const spam = useCampaignSpamScore(
    {
      subject: campaignData.subject,
      previewText: campaignData.previewText ?? null,
      htmlContent: campaignData.htmlContent,
      senderId: campaignData.senderId,
      listId,
      trackOpens: campaignData.trackOpens,
      unsubscribeEnabled: campaignData.unsubscribeEnabled,
    },
    isOpen,
  )

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
      const [title, description] = toastParts(sentMessage(res))
      toast.success(title, { description })
      done()
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to send campaign')
    }
  })

  const scheduleMutation = useMutation({
    mutationFn: async (plan: { scheduledAt: string; batches: Batches }) => save(plan),
    onSuccess: (_res, plan) => {
      const when = new Date(plan.scheduledAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      toast.success('Campaign scheduled', { description: plan.batches ? `From ${when}, ${plan.batches.size} ${everyText(plan.batches.everyMinutes)}.` : `It sends ${when}.` })
      done()
    },
    onError: (err: any) => {
      setErrorMsg(err.message || 'Failed to schedule campaign')
    }
  })

  const missingFields = []
  if (!campaignData.name) missingFields.push('A campaign name')
  if (!campaignData.senderEmail) missingFields.push('Who it sends from')
  if (!campaignData.subject) missingFields.push('A subject line')
  if (!campaignData.selectedListId) missingFields.push('A list to send to')
  if (!campaignData.htmlContent) missingFields.push('The email itself')

  const isCampaignInvalid = missingFields.length > 0

  /** The date and time picked, as an ISO string, or null after saying what's wrong with them. */
  const pickedTime = (): string | null => {
    if (!scheduleDate || !scheduleTime) {
      setErrorMsg('Choose a date and a time.')
      return null
    }
    const combinedDateTime = new Date(`${scheduleDate}T${scheduleTime}`)
    if (isNaN(combinedDateTime.getTime())) {
      setErrorMsg("That date or time isn't valid.")
      return null
    }
    if (combinedDateTime.getTime() <= Date.now()) {
      setErrorMsg('Choose a time in the future.')
      return null
    }
    return combinedDateTime.toISOString()
  }

  const startsLater = selectedOption === 'later' || (selectedOption === 'batches' && batchStart === 'later')

  const handleConfirm = async () => {
    if (isCampaignInvalid) return
    if (!(await confirmSpamRisk(spam.data, 'This campaign'))) return
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
  const INPUT = INPUT_CLASS
  const option = (on: boolean) =>
    `rounded-md-s border transition-colors ${on ? 'border-accent ring-1 ring-accent' : 'border-control hover:border-input'}`
  const optionHead = 'flex cursor-pointer items-start gap-3 px-4 py-3.5'
  const radio = 'mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)] cursor-pointer'
  const optionTitle = 'block text-sm font-medium text-foreground'
  const optionText = 'mt-0.5 block text-[13px] leading-5 text-muted-foreground'
  const optionMore = 'space-y-3.5 border-t border-border px-4 pb-4 pt-3.5'
  const dateAndTime = (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Date">
        <input
          id="schedule-date"
          type="date"
          data-empty={!scheduleDate}
          value={scheduleDate}
          onChange={(e) => setScheduleDate(e.target.value)}
          min={new Date().toISOString().split('T')[0]}
          className={INPUT}
        />
      </Field>
      <Field label="Time">
        <input id="schedule-time" type="time" data-empty={!scheduleTime} value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className={INPUT} />
      </Field>
    </div>
  )

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Send or schedule" description={campaignData.name || undefined} className="sm:max-w-lg">
          <DialogBody className="space-y-5">
            {isCampaignInvalid && (
              <Notice level="warning" title="Finish the campaign first">
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {missingFields.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {unconfirmed && unconfirmed.unconfirmed > 0 && (
              <Notice title={`${unconfirmed.unconfirmed} of ${unconfirmed.total} recipients have unverified addresses`}>
                At companies whose mail server accepts every address, or that couldn't be checked.
                {unconfirmed.unconfirmed > unconfirmed.firstBatch
                  ? ` The first ${unconfirmed.firstBatch} go out with everyone else; the rest follow at least ${hours(unconfirmed.holdHours)} later, once their bounces are in, unless more than ${pct(unconfirmed.maxBounceRate)} of those bounce.`
                  : ' Some may bounce.'}
              </Notice>
            )}

            <fieldset className="space-y-2.5">
              <legend className="mb-2.5 text-[13px] font-medium text-foreground">When should it go out?</legend>

              <div className={option(selectedOption === 'now')}>
                <label className={optionHead}>
                  <input type="radio" name="send-option" checked={selectedOption === 'now'} onChange={() => setSelectedOption('now')} className={radio} />
                  <span>
                    <span className={optionTitle}>Now</span>
                    <span className={optionText}>Everyone on the list gets it straight away.</span>
                  </span>
                </label>
              </div>

              <div className={option(selectedOption === 'later')}>
                <label className={optionHead}>
                  <input type="radio" name="send-option" checked={selectedOption === 'later'} onChange={() => setSelectedOption('later')} className={radio} />
                  <span>
                    <span className={optionTitle}>At a time you choose</span>
                    <span className={optionText}>Sends automatically at the time you pick.</span>
                  </span>
                </label>
                {selectedOption === 'later' && <div className={optionMore}>{dateAndTime}</div>}
              </div>

              <div className={option(selectedOption === 'batches')}>
                <label className={optionHead}>
                  <input type="radio" name="send-option" checked={selectedOption === 'batches'} onChange={() => setSelectedOption('batches')} className={radio} />
                  <span>
                    <span className={optionTitle}>In batches</span>
                    <span className={optionText}>A set number at a time, with a wait between.</span>
                  </span>
                </label>
                {selectedOption === 'batches' && (
                  <div className={optionMore}>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Emails per batch">
                        <input id="batch-size" type="number" min={1} step={1} inputMode="numeric" value={batchSize} onChange={(e) => setBatchSize(e.target.value)} className={INPUT} />
                      </Field>
                      <Field label="Wait between">
                        <Select id="batch-wait" value={batchWait} onChange={(e) => setBatchWait(Number(e.target.value))} className={`${INPUT} text-left`}>
                          {BATCH_WAITS.map((w) => (
                            <option key={w.minutes} value={w.minutes}>
                              {w.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Field label="First batch">
                      <Select id="batch-start" value={batchStart} onChange={(e) => setBatchStart(e.target.value as 'now' | 'later')} className={`${INPUT} text-left`}>
                        <option value="now">Goes now</option>
                        <option value="later">Goes at a time I choose</option>
                      </Select>
                    </Field>
                    {batchStart === 'later' && dateAndTime}
                    <p className="text-[13px] leading-5 text-muted-foreground">
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
            </fieldset>

            {!isCampaignInvalid && (
              <div>
              <SpamScoreCard score={spam.data} loading={spam.isFetching} error={spam.error ? (spam.error as Error).message : null} defaultOpen={spam.data?.level === 'high'} onFixWithAI={onFixWithAI} />
              </div>
            )}

            {errorMsg && <Notice level="error">{errorMsg}</Notice>}
          </DialogBody>

          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void handleConfirm()} disabled={isScheduleDisabled || isPending || isCampaignInvalid} isLoading={isPending}>
              {startsLater
                ? 'Schedule campaign'
                : selectedOption === 'batches'
                  ? 'Send first batch'
                  : unconfirmed?.total
                    ? `Send to ${unconfirmed.total.toLocaleString('en-GB')} ${unconfirmed.total === 1 ? 'person' : 'people'}`
                    : 'Send now'}
            </Button>
          </DialogFooter>
    </Dialog>
  )
}
