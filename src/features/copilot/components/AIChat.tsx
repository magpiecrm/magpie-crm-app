import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, ArrowUp, BrainCircuit, Cpu, AlertCircle, Trash2, User, X, Check, Loader2, ShieldAlert, ShieldCheck, ShieldOff, Gauge, Search, ChevronDown, Wrench, SquarePen, History, MessageSquare } from 'lucide-react'
import type { PersonaFormValues, PersonaUpdates } from '../../prospects/components/PersonaForm'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { listCopilotChatsFn, deleteCopilotChatFn } from '../../../server/functions'
import { useCopilotStream, type PermissionMode, type ToolCall } from '../useCopilotStream'
import { createPortal } from 'react-dom'
import { Dialog } from '../../../components/ui/Dialog'
import type { CopilotClientState } from '../../../server/copilot/types'
import { SURVEY_ACTION_PREFIX } from '../../survey-builder/applyAction'

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-accent">
          {part.slice(1, -1)}
        </code>
      )
    }

    const boldParts = part.split(/(\*\*[^*]+\*\*)/g)
    return boldParts.map((bPart, bIdx) => {
      if (bPart.startsWith('**') && bPart.endsWith('**')) {
        return <strong key={`${index}-${bIdx}`} className="font-bold text-foreground">{bPart.slice(2, -2)}</strong>
      }

      const italicParts = bPart.split(/(\*[^*]+\*)/g)
      return italicParts.map((iPart, iIdx) => {
        if (iPart.startsWith('*') && iPart.endsWith('*')) {
          return <em key={`${index}-${bIdx}-${iIdx}`} className="italic">{iPart.slice(1, -1)}</em>
        }
        return iPart
      })
    })
  })
}

function parseMarkdown(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g)
  return parts.map((part, index) => {
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/)
      const lang = match ? match[1] : ''
      const code = match ? match[2] : part.slice(3, -3)
      return (
        <pre key={index} className="bg-muted/70 p-3 rounded-md-s font-mono text-xs overflow-x-auto my-3 border border-border text-foreground select-text">
          {lang && <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1.5 border-b border-border pb-1 font-sans">{lang}</div>}
          <code className="block whitespace-pre">{code.trim()}</code>
        </pre>
      )
    }
    
    const lines = part.split('\n')
    const renderedLines: React.ReactNode[] = []
    let listItems: React.ReactNode[] = []

    const flushList = (key: string | number) => {
      if (listItems.length > 0) {
        renderedLines.push(
          <ul key={`list-${key}`} className="list-disc pl-5 my-2 space-y-1">
            {listItems}
          </ul>
        )
        listItems = []
      }
    }

    lines.forEach((line, lineIdx) => {
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
      if (headingMatch) {
        flushList(lineIdx)
        const level = headingMatch[1].length
        const headingText = renderInlineMarkdown(headingMatch[2])
        const classes = level === 1 
          ? "text-lg font-bold mt-4 mb-2 text-foreground" 
          : level === 2 
            ? "text-base font-bold mt-3 mb-2 text-foreground" 
            : "text-sm font-bold mt-2.5 mb-1.5 text-foreground"
        renderedLines.push(<div key={lineIdx} className={classes}>{headingText}</div>)
        return
      }

      const listMatch = line.match(/^[-*+]\s+(.*)$/)
      if (listMatch) {
        listItems.push(<li key={lineIdx} className="text-sm leading-relaxed">{renderInlineMarkdown(listMatch[1])}</li>)
        return
      }

      if (line.trim() === '') {
        flushList(lineIdx)
        return
      }

      flushList(lineIdx)
      renderedLines.push(<p key={lineIdx} className="text-sm leading-relaxed my-1.5">{renderInlineMarkdown(line)}</p>)
    })

    flushList('final')
    return <div key={index}>{renderedLines}</div>
  })
}

interface BuilderAction {
  action: string
  args: any
}

interface AIChatProps {
  onClose?: () => void
  pageContext?: string
  campaignContext?: {
    id: number
    name: string
    subject?: string
    htmlContent?: string
  }
  /** Set when the open builder is editing a saved template rather than a campaign. */
  templateContext?: {
    id: string
    name: string
  }
  builderContext?: {
    blocks: any[]
    globalStyle: any
    selectedBlockId?: string | null
  }
  onBuilderAction?: (actions: BuilderAction[]) => void
  personaContext?: {
    persona: PersonaFormValues
  }
  onPersonaAction?: (updates: PersonaUpdates) => void
  surveyBuilderContext?: {
    survey: { id: string; name: string; status: string; hasResponses: boolean }
    pages: unknown[]
    theme: Record<string, unknown>
    selectedPageId?: string | null
    selectedBlockId?: string | null
  }
  /** Receives `survey.*` client actions; everything else goes to the email builder. */
  onSurveyBuilderAction?: (actions: BuilderAction[]) => void
}

/**
 * Current Claude model IDs the CLI's --model flag accepts (verified against
 * the installed CLI: full ids and short aliases like "opus"/"sonnet" both
 * resolve, but full ids are unambiguous about which generation actually runs).
 * "CLI Default" with no --model omitted resolves to whatever the CLI ships as
 * its own default (currently Opus 5) rather than duplicating that choice here.
 */
const CLAUDE_MODELS = [
  { label: 'Opus 5 (most capable)', value: 'claude-opus-5' },
  { label: 'Sonnet 5 (balanced)', value: 'claude-sonnet-5' },
  { label: 'Haiku 4.5 (fastest)', value: 'claude-haiku-4-5' },
] as const

interface DropdownOption {
  id: string
  label: string
  /** Shown on the collapsed pill. Falls back to `label` when omitted. */
  shortLabel?: string
  description?: string
  icon: React.ReactNode
}

const MODEL_OPTIONS: DropdownOption[] = [
  { id: '', label: 'Claude (Default)', shortLabel: 'Default', icon: <Cpu className="w-3.5 h-3.5 text-orange-500" /> },
  ...CLAUDE_MODELS.map(m => ({
    id: m.value,
    label: m.label,
    shortLabel: m.label.split(' (')[0],
    icon: <Cpu className="w-3.5 h-3.5 text-orange-500" />,
  })),
]

/**
 * Mirrors `PERMISSION_MODES` in `server/copilot/permissions.ts` (id/label/
 * description copied verbatim). Duplicated rather than imported: that module
 * pulls in the whole tool registry — db, the SocialFetch client, the email finder
 * — which must not end up in the client bundle.
 */
const PERMISSION_MODE_OPTIONS: DropdownOption[] = [
  {
    id: 'auto-safe',
    label: 'Auto-approve safe edits',
    shortLabel: 'Auto',
    description: 'Reads and design edits run freely; destructive changes still ask.',
    icon: <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />,
  },
  {
    id: 'ask',
    label: 'Always ask',
    shortLabel: 'Ask',
    description: 'Approve every tool that changes something.',
    icon: <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />,
  },
  {
    id: 'bypass',
    label: 'Bypass',
    description: 'Run everything without prompting.',
    icon: <ShieldOff className="w-3.5 h-3.5 text-destructive" />,
  },
]

/** Values match the CLI's --effort choices exactly (`claude --help`). */
const EFFORT_OPTIONS: DropdownOption[] = [
  { id: '', label: 'Default', description: 'The model paces itself.', icon: <Gauge className="w-3.5 h-3.5 text-accent" /> },
  { id: 'low', label: 'Low', description: 'Fastest, least thorough.', icon: <Gauge className="w-3.5 h-3.5 text-accent" /> },
  { id: 'medium', label: 'Medium', icon: <Gauge className="w-3.5 h-3.5 text-accent" /> },
  { id: 'high', label: 'High', icon: <Gauge className="w-3.5 h-3.5 text-accent" /> },
  { id: 'xhigh', label: 'XHigh', description: 'Best for hard, agentic requests.', icon: <Gauge className="w-3.5 h-3.5 text-accent" /> },
  { id: 'max', label: 'Max', description: 'Slowest; correctness over cost.', icon: <Gauge className="w-3.5 h-3.5 text-accent" /> },
]

/**
 * Composer pill: shows the current selection, opens a searchable list on
 * click. Not portalled — it only ever needs to sit within the chat panel it
 * is rendered in, unlike the full-page history Dialog.
 */
function ComposerDropdown({
  options,
  selectedId,
  onSelect,
  align = 'left',
}: {
  options: DropdownOption[]
  selectedId: string
  onSelect: (id: string) => void
  /** Which edge the popover hangs from. 'right' keeps it inside a narrow panel for a pill near the right edge. */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.id === selectedId) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  return (
    // `min-w-0` lets this shrink below its content size inside the nowrap
    // pill row; the label span (not this container) is what actually
    // truncates, so the icon and chevron never get squeezed out.
    <div ref={containerRef} className="relative min-w-0 shrink">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected.label}
        className={`flex items-center gap-1 min-w-0 w-full px-1.5 py-1 rounded-md-xs text-[11px] font-medium transition-colors cursor-pointer ${
          open ? 'text-accent bg-accent/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
      >
        <span className="shrink-0 flex items-center">{selected.icon}</span>
        <span className="min-w-0 truncate">{selected.shortLabel ?? selected.label}</span>
        <ChevronDown className={`w-2.5 h-2.5 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute bottom-full ${align === 'right' ? 'right-0' : 'left-0'} mb-2 w-60 bg-card border border-border rounded-md-m shadow-xl z-50 overflow-hidden animate-in fade-in duration-100`}
        >
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-border/60">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search..."
              className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">No matches.</p>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={opt.id === selectedId}
                  onClick={() => {
                    onSelect(opt.id)
                    setOpen(false)
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <span className="shrink-0">{opt.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-foreground truncate">{opt.label}</span>
                    {opt.description && (
                      <span className="block text-[10px] text-muted-foreground truncate">{opt.description}</span>
                    )}
                  </span>
                  {opt.id === selectedId && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** One tool call, shown inline so the user can see what the copilot actually did. */
function ToolChip({ tool }: { tool: ToolCall }) {
  const tone =
    tool.status === 'error'
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : tool.status === 'running'
      ? 'border-accent/30 bg-accent/5 text-accent'
      : 'border-border bg-muted/50 text-muted-foreground'

  return (
    <span
      title={tool.preview ?? JSON.stringify(tool.args)}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md-xs border text-[10px] font-mono ${tone}`}
    >
      {tool.status === 'running' ? (
        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
      ) : tool.status === 'error' ? (
        <AlertCircle className="w-3 h-3 shrink-0" />
      ) : (
        <Wrench className="w-3 h-3 shrink-0" />
      )}
      {tool.name}
    </span>
  )
}

export function AIChat({
  onClose,
  pageContext,
  campaignContext,
  templateContext,
  builderContext,
  onBuilderAction,
  personaContext,
  onPersonaAction,
  surveyBuilderContext,
  onSurveyBuilderAction,
}: AIChatProps) {
  const provider = 'claude' as const
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [effort, setEffort] = useState<string>('')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto-safe')
  const [prompt, setPrompt] = useState('')

  const chatEndRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const greeting = personaContext
    ? 'Hi! I can help you build this persona. Describe your product and who you sell to, and I will fill in the targeting criteria, pain points, and value proposition as we go.'
    : surveyBuilderContext
    ? 'Hi! I can help you build this survey: add questions, set up skip logic, style it, or map answers to contact fields.'
    : 'Hello! I am your AI Copilot. I can help you manage contacts, import subscribers, build email campaigns, and analyze marketing performance.'

  /**
   * Browser-owned state, sent alongside each turn.
   *
   * This used to be `JSON.stringify`d into the prompt on every message — the
   * whole block list, every time. Now the server holds it for the session and
   * the copilot reads it on demand via getBlocks/getOpenPersona.
   */
  const getClientState = useCallback((): CopilotClientState => {
    const state: CopilotClientState = {}
    if (pageContext) state.route = pageContext
    if (campaignContext && campaignContext.id > 0) {
      state.campaign = {
        id: campaignContext.id,
        name: campaignContext.name,
        subject: campaignContext.subject,
      }
    }
    if (templateContext) state.template = { id: templateContext.id, name: templateContext.name }
    if (builderContext) {
      state.builder = {
        blocks: builderContext.blocks,
        globalStyle: builderContext.globalStyle,
        selectedBlockId: builderContext.selectedBlockId,
      }
    }
    if (personaContext) state.persona = personaContext.persona as unknown as Record<string, unknown>
    if (surveyBuilderContext) {
      state.survey = surveyBuilderContext.survey
      state.surveyBuilder = {
        surveyId: surveyBuilderContext.survey.id,
        pages: surveyBuilderContext.pages,
        theme: surveyBuilderContext.theme,
        selectedPageId: surveyBuilderContext.selectedPageId,
        selectedBlockId: surveyBuilderContext.selectedBlockId,
      }
    }
    return state
  }, [pageContext, campaignContext, templateContext, builderContext, personaContext, surveyBuilderContext])

  const handleClientAction = useCallback(
    (action: { action: string; args: any }) => {
      if (action.action === 'updatePersona') {
        onPersonaAction?.(action.args as PersonaUpdates)
      } else if (action.action.startsWith(SURVEY_ACTION_PREFIX)) {
        onSurveyBuilderAction?.([{ action: action.action, args: action.args }])
      } else {
        onBuilderAction?.([{ action: action.action, args: action.args }])
      }
    },
    [onBuilderAction, onPersonaAction, onSurveyBuilderAction],
  )

  const {
    messages,
    isStreaming,
    activeTools,
    pendingPermission,
    currentChatId,
    send,
    newChat,
    loadChat,
    respondToPermission,
  } = useCopilotStream({ getClientState, onClientAction: handleClientAction, greeting })

  const queryClient = useQueryClient()
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)

  const { data: chatsData } = useQuery({
    queryKey: queryKeys.copilot.chats(),
    queryFn: () => listCopilotChatsFn(),
    // Only worth fetching while the list is on screen.
    enabled: isHistoryOpen,
  })
  const chats = (chatsData as any)?.chats ?? []

  const deleteChatMutation = useMutation({
    mutationFn: (id: string) => deleteCopilotChatFn({ data: { id } }),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.copilot.chats() })
      // Deleting the conversation you are looking at leaves you on a new one.
      if (id === currentChatId) newChat()
    },
  })

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, activeTools, pendingPermission])

  // Grows the textarea with its content instead of scrolling internally,
  // capped by the `max-h-40` on the element itself.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [prompt])

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || isStreaming) return
    const text = prompt
    setPrompt('')
    void send(text, { provider, model: selectedModel || undefined, effort: effort || undefined, permissionMode })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      formRef.current?.requestSubmit()
    }
  }


  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      {/* Header */}
      <div className="h-16 px-4 border-b border-border bg-muted/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-accent/10 rounded-md-s text-accent">
            <BrainCircuit className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-bold text-foreground text-sm flex items-center gap-1.5">
              AI Copilot
            </h2>
            <p className="text-[10px] text-muted-foreground">AI-powered marketing assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setIsHistoryOpen(false)
              newChat()
            }}
            className="p-1.5 text-muted-foreground hover:text-accent hover:bg-accent/10 rounded-md-s transition-colors cursor-pointer"
            title="New chat"
          >
            <SquarePen className="w-4 h-4" />
          </button>

          <button
            onClick={() => setIsHistoryOpen(true)}
            aria-haspopup="dialog"
            className="p-1.5 rounded-md-s transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Previous chats"
          >
            <History className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md-s transition-colors"
              title="Close Panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Window */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar bg-background/50">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex gap-4 max-w-4xl mx-auto ${
              msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {/* Avatar */}
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                msg.role === 'user'
                  ? 'bg-accent text-accent-foreground'
                  : msg.isError
                  ? 'bg-destructive/10 text-destructive border border-destructive/20'
                  : 'bg-card text-muted-foreground border border-border'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="w-4 h-4" />
              ) : msg.isError ? (
                <AlertCircle className="w-4 h-4" />
              ) : (
                <Bot className="w-4 h-4 text-accent" />
              )}
            </div>

            {/* Message bubble */}
            <div className="flex flex-col gap-1 max-w-[85%]">
              <div
                className={`p-4 rounded-md-m shadow-premium border relative select-text ${
                  msg.role === 'user'
                    ? 'bg-accent text-accent-foreground border-accent/20 rounded-tr-none'
                    : msg.isError
                    ? 'bg-destructive/5 border-destructive/25 text-destructive rounded-tl-none font-mono text-xs whitespace-pre-wrap'
                    : 'bg-card text-foreground border-border rounded-tl-none'
                }`}
              >
                {!msg.isError && msg.role === 'assistant' ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none font-sans select-text">
                    {parseMarkdown(msg.content)}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap leading-relaxed select-text">{msg.content}</p>
                )}
              </div>

              {/* What the copilot actually did to produce this message */}
              {msg.tools && msg.tools.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1 mt-1">
                  {msg.tools.map(tool => (
                    <ToolChip key={tool.id} tool={tool} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Live tool activity for the turn in flight */}
        {isStreaming && activeTools.length > 0 && (
          <div className="flex gap-4 max-w-4xl mx-auto">
            <div className="w-8 h-8 shrink-0" />
            <div className="flex flex-wrap gap-1.5">
              {activeTools.map(tool => (
                <ToolChip key={tool.id} tool={tool} />
              ))}
            </div>
          </div>
        )}

        {/* Approval prompt — the tool call is genuinely paused until answered */}
        {pendingPermission && (
          <div className="flex gap-4 max-w-4xl mx-auto">
            <div className="w-8 h-8 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4 text-amber-500" />
            </div>
            <div className="bg-card border border-amber-500/30 rounded-md-m p-4 shadow-premium rounded-tl-none max-w-[85%] space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Allow <code className="font-mono text-accent">{pendingPermission.tool}</code>?
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{pendingPermission.reason}</p>
              </div>
              <pre className="text-[11px] font-mono bg-muted/60 border border-border rounded-md-s p-2.5 overflow-x-auto max-h-40 select-text">
                {JSON.stringify(pendingPermission.args, null, 2)}
              </pre>
              <div className="flex gap-2">
                <button
                  onClick={() => respondToPermission(pendingPermission.id, true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md-s text-xs font-semibold hover:bg-primary/85 transition-all cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" /> Allow
                </button>
                <button
                  onClick={() => respondToPermission(pendingPermission.id, false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground rounded-md-s text-xs font-semibold transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" /> Deny
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading Indicator */}
        {isStreaming && !pendingPermission && (
          <div className="flex gap-4 max-w-4xl mx-auto">
            <div className="w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-accent animate-pulse" />
            </div>
            <div className="bg-card text-foreground border border-border p-4 rounded-md-m shadow-premium rounded-tl-none max-w-[80%] flex items-center gap-3">
              <div className="flex space-x-1">
                <span className="w-2.5 h-2.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2.5 h-2.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2.5 h-2.5 bg-accent/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {activeTools.some(t => t.status === 'running')
                  ? `Running ${activeTools.filter(t => t.status === 'running').map(t => t.name).join(', ')}...`
                  : 'Thinking with Claude...'}
              </span>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Composer */}
      <div className="p-4 border-t border-border bg-card shrink-0 safe-b">
        <form
          ref={formRef}
          onSubmit={handleSend}
          className="max-w-4xl mx-auto rounded-md-m border border-border bg-background focus-within:ring-2 focus-within:ring-accent/50 focus-within:border-accent transition-shadow"
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            rows={1}
            placeholder='Ask anything... "Build a Black Friday campaign for the VIP list"'
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-55 max-h-40 overflow-y-auto"
          />

          <div className="flex items-center justify-between gap-1.5 px-2 pb-2 pt-1">
            {/*
             * `flex-nowrap` (the default) + `min-w-0` on this row and on each
             * pill below: the three pills share whatever width is left after
             * the fixed-size send button, shrinking together and truncating
             * their own label before the row is ever allowed to wrap. This is
             * what guarantees one line at the panel's 350px floor (see the
             * resize clamp in __root.tsx), not a width breakpoint that could
             * stop matching at some other size.
             */}
            <div className="flex items-center gap-0.5 min-w-0 flex-1">
              <ComposerDropdown
                options={PERMISSION_MODE_OPTIONS}
                selectedId={permissionMode}
                onSelect={(id) => setPermissionMode(id as PermissionMode)}
              />
              <ComposerDropdown options={MODEL_OPTIONS} selectedId={selectedModel} onSelect={setSelectedModel} />
              <ComposerDropdown options={EFFORT_OPTIONS} selectedId={effort} onSelect={setEffort} align="right" />
            </div>

            <button
              type="submit"
              disabled={!prompt.trim() || isStreaming}
              title="Send"
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-accent hover:brightness-110 disabled:opacity-40 text-accent-foreground transition-all cursor-pointer"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {/*
       * Portalled to <body>: the chat panel's slide-in animation puts an
       * inline `transform` on its ancestor <aside> (see __root.tsx), and a
       * transform creates a new containing block for `position: fixed`
       * descendants — so without the portal, Dialog's fixed overlay centers
       * within that ~400px panel instead of the real viewport.
       */}
      {/* `isHistoryOpen &&` must come before createPortal, not just inside
          Dialog's own isOpen check — createPortal's arguments (document.body)
          are evaluated unconditionally as soon as this line runs, including
          during SSR where `document` does not exist. */}
      {isHistoryOpen && createPortal(
        <Dialog
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          title="Previous chats"
          className="max-w-xl"
        >
        <div className="max-h-[65vh] overflow-y-auto p-2 sm:p-3">
          {chats.length === 0 ? (
            <p className="py-12 text-sm text-muted-foreground text-center">No saved chats yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {chats.map((chat: any) => (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-3 rounded-md-s px-3 py-3 hover:bg-muted/50 transition-colors ${
                    chat.id === currentChatId ? 'bg-accent/5' : ''
                  }`}
                >
                  <button
                    onClick={() => {
                      setIsHistoryOpen(false)
                      void loadChat(chat.id)
                    }}
                    className="flex-1 min-w-0 flex items-start gap-3 text-left cursor-pointer"
                  >
                    <MessageSquare
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        chat.id === currentChatId ? 'text-accent' : 'text-muted-foreground'
                      }`}
                    />
                    <span className="min-w-0">
                      <span
                        className={`block text-sm truncate ${
                          chat.id === currentChatId ? 'text-accent font-semibold' : 'text-foreground font-medium'
                        }`}
                      >
                        {chat.title}
                      </span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {chat.messageCount} message{chat.messageCount === 1 ? '' : 's'} ·{' '}
                        {new Date(chat.updatedAt).toLocaleDateString()}
                      </span>
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      if (confirm(`Delete "${chat.title}"? This cannot be undone.`)) {
                        deleteChatMutation.mutate(chat.id)
                      }
                    }}
                    disabled={deleteChatMutation.isPending}
                    title="Delete chat"
                    className="p-1.5 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md-xs transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        </Dialog>,
        document.body,
      )}
    </div>
  )
}
