import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { AlertTriangle, Mail, BarChart3, Search, Users, Contact, LogOut, Settings, FileText, UserCircle, X, ClipboardList, LayoutTemplate, Building2, Kanban, Handshake, ListChecks, Repeat, ChevronDown, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { markSignedOut } from '../../utils/auth'
import { checkAuthFn, getUsageFn, logoutFn, prospectingStatusFn, tasksFn } from '../../server/functions'
import { dueBucket } from '../../features/sales/tasks'
import { AllowanceMeter } from '../../features/settings/components/AllowanceMeter'
import { Avatar } from '../ui/Avatar'
import { MagpieWordmark } from '../ui/MagpieLogo'

// Grouped by the job being done: finding people, the people themselves,
// selling to them, and marketing to them.
const navItems = [
  {
    label: 'Find',
    items: [
      { label: 'Prospect Search', to: '/collection/prospect-search', icon: Search },
      { label: 'Personas', to: '/collection/personas', icon: UserCircle },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Contacts', to: '/marketing/contacts', icon: Contact },
      { label: 'Companies', to: '/marketing/companies', icon: Building2 },
      { label: 'Lists', to: '/marketing/lists', icon: Users },
    ],
  },
  {
    label: 'Sell',
    items: [
      { label: 'Pipeline', to: '/sales/pipeline', icon: Kanban },
      { label: 'Deals', to: '/sales/deals', icon: Handshake },
      { label: 'Sequences', to: '/sales/sequences', icon: Repeat },
      { label: 'Tasks', to: '/sales/tasks', icon: ListChecks },
    ],
  },
  {
    label: 'Market',
    items: [
      { label: 'Campaigns', to: '/marketing/campaigns', icon: Mail },
      { label: 'Templates', to: '/marketing/templates', icon: LayoutTemplate },
      { label: 'Forms', to: '/marketing/forms', icon: FileText },
      { label: 'Surveys', to: '/marketing/surveys', icon: ClipboardList },
      { label: 'Analytics', to: '/marketing/analytics', icon: BarChart3 },
    ],
  },
]

/** Which sections each person has folded away, kept in their browser. */
const FOLDED_KEY = 'magpie.sidebar.folded'
const SHORT_LABEL = { prospects: 'Credits', reveals: 'Reveals', emailsSent: 'Emails' } as const

type Usage = Awaited<ReturnType<typeof getUsageFn>>
type Status = Awaited<ReturnType<typeof prospectingStatusFn>>

/**
 * One line above the account row: a plan's allowances as thin meters, or
 * (self-hosted) the SocialFetch balance. The full detail is in the account
 * menu and Settings, so the sidebar's links get the height.
 */
function UsageStrip({ usage, status, onNavigate }: { usage?: Usage; status?: Status; onNavigate?: () => void }) {
  const items = usage?.allowance?.items ?? []
  if (items.length) {
    return (
      <Link to="/settings" onClick={onNavigate} className="flex gap-3 rounded-md-s px-1 py-1 hover:bg-muted transition-colors" title="Your plan this month">
        {items.map(({ kind, used, limit }) => {
          const share = limit > 0 ? Math.min(1, used / limit) : 1
          const out = used >= limit
          return (
            <span key={kind} className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="flex justify-between gap-1 text-[11px] leading-none">
                <span className={out ? 'text-destructive font-semibold' : 'text-muted-foreground'}>{SHORT_LABEL[kind]}</span>
                <span className="tabular-nums text-foreground">{used.toLocaleString()}</span>
              </span>
              <span
                className="h-1 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-label={`${SHORT_LABEL[kind]}: ${used.toLocaleString()} of ${limit.toLocaleString()}`}
                aria-valuemin={0}
                aria-valuemax={limit}
                aria-valuenow={Math.min(used, limit)}
              >
                <span className={`block h-full rounded-full ${out ? 'bg-destructive' : share >= 0.9 ? 'bg-amber-500' : 'bg-accent'}`} style={{ width: `${share * 100}%` }} />
              </span>
            </span>
          )
        })}
      </Link>
    )
  }
  if (!status) return null
  const sf = status.socialfetch
  if (!sf.balanceHidden && !sf.configured) {
    return (
      <Link to="/settings" search={{ tab: 'source' }} onClick={onNavigate} className="block px-1 py-1 text-xs font-semibold text-accent hover:underline">
        Add your SocialFetch API key
      </Link>
    )
  }
  return (
    <p className="flex items-baseline justify-between gap-2 px-1 py-1 text-[11px] text-muted-foreground">
      <span>{sf.balanceHidden ? 'Prospects this month' : 'SocialFetch credits'}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">
        {sf.balanceHidden ? (sf.prospectsThisMonth ?? 0).toLocaleString() : sf.balance === null ? 'Unavailable' : sf.balance.toLocaleString()}
      </span>
    </p>
  )
}

export function Sidebar({
  onToggleChat,
  isChatOpen,
  isOpen = false,
  onClose,
}: {
  onToggleChat?: () => void
  isChatOpen?: boolean
  /** Drawer state below `lg`. At `lg`+ the sidebar is always visible. */
  isOpen?: boolean
  onClose?: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const handleSignOut = async () => {
    // Ends the session on the server too, so the cookie can't be reused.
    await logoutFn().catch(() => {})
    markSignedOut()
    // Signing out ends the session's working data too: search results,
    // revealed emails and saved filters, so the next person to sign in on
    // this tab doesn't see them.
    queryClient.clear()
    try {
      sessionStorage.clear()
    } catch {
      // storage unavailable; nothing was kept there
    }
    navigate({ to: '/login' })
  }

  const { data: status } = useQuery({
    queryKey: queryKeys.prospects.status(),
    queryFn: () => prospectingStatusFn(),
    refetchInterval: 60000, // Refresh every minute
  })
  // A hosting plan's allowances, when there are any, take the balance's place.
  const { data: usage } = useQuery({ queryKey: queryKeys.settings.usage(), queryFn: () => getUsageFn(), refetchInterval: 60000 })
  const hasAllowance = Boolean(usage?.allowance?.items.length)
  // Open tasks due today or overdue, as a count beside Tasks.
  const { data: tasks } = useQuery({ queryKey: queryKeys.sales.tasks({}), queryFn: () => tasksFn({ data: {} }), refetchInterval: 60000 })
  const tasksDue = (tasks ?? []).filter((t) => !t.done_at && ['overdue', 'today'].includes(dueBucket(t.due_at))).length
  const { data: account } = useQuery({ queryKey: queryKeys.account(), queryFn: () => checkAuthFn(), staleTime: 5 * 60_000 })
  const email = account?.isAuthenticated ? account.email : ''

  // Sections fold away to make room on short screens. Read after mount (the
  // server has no localStorage), and the section you go to always unfolds.
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = navItems.find((section) => section.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`)))?.label
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      setFolded(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '{}'))
    } catch {
      // storage unavailable or unreadable: everything stays open
    }
  }, [])
  const toggleFolded = (label: string) =>
    setFolded((f) => {
      const next = { ...f, [label]: !f[label] }
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify(next))
      } catch {
        // not kept; folds last until the page reloads
      }
      return next
    })
  useEffect(() => {
    if (current) setFolded((f) => (f[current] ? { ...f, [current]: false } : f))
  }, [current])

  // The account menu: plan detail, Settings and Sign out. Closes on a click outside, Escape, or going somewhere.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])
  useEffect(() => setMenuOpen(false), [pathname])
  const go = () => {
    setMenuOpen(false)
    onClose?.()
  }

  return (
    <aside
      className={`w-64 border-r border-border bg-card fixed left-0 top-0 bottom-0 z-50 flex flex-col safe-t transition-transform duration-300 ease-out lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-2 shrink-0">
        <MagpieWordmark />
        <button
          onClick={onClose}
          aria-label="Close navigation"
          className="lg:hidden touch-target flex items-center justify-center p-2 -mr-2 text-muted-foreground hover:text-foreground rounded-md-s hover:bg-muted transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Only the links scroll, and only when they have to: the logo and the account stay put. */}
      <nav className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-3 space-y-3">
        {navItems.map((section) => {
          const open = !folded[section.label]
          const listId = `nav-${section.label.toLowerCase()}`
          return (
            <div key={section.label}>
              <h2>
                <button
                  type="button"
                  onClick={() => toggleFolded(section.label)}
                  aria-expanded={open}
                  aria-controls={listId}
                  className="group flex w-full items-center gap-2 rounded-md-s px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <span>{section.label}</span>
                  {/* Folded away, a section still says when a task in it is due. */}
                  {!open && section.items.some((item) => item.to === '/sales/tasks') && tasksDue > 0 && (
                    <span className="min-w-5 rounded-full bg-accent px-1.5 text-center font-sans text-[11px] font-semibold normal-case tracking-normal tabular-nums text-accent-foreground" aria-label={`${tasksDue} tasks due`}>
                      {tasksDue}
                    </span>
                  )}
                  {open ? (
                    <ChevronDown className="ml-auto w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" />
                  ) : (
                    <ChevronRight className="ml-auto w-3.5 h-3.5" />
                  )}
                </button>
              </h2>
              {open && (
                <ul id={listId} className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.to}>
                      {item.to === '/ai-chat' ? (
                        <button
                          onClick={() => { onToggleChat?.(); onClose?.() }}
                          className={`flex w-full items-center gap-3 px-3 py-1.5 text-sm rounded-md-s hover:bg-muted transition-colors md-state-hover text-left cursor-pointer ${
                            isChatOpen
                              ? 'bg-muted text-foreground font-medium'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <item.icon className="w-4 h-4" />
                          {item.label}
                        </button>
                      ) : (
                        <Link
                          to={item.to}
                          onClick={onClose}
                          activeProps={{
                            className: '!bg-muted !text-foreground font-medium',
                          }}
                          className="flex items-center gap-3 px-3 py-1.5 text-sm text-muted-foreground rounded-md-s hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <item.icon className="w-4 h-4" />
                          {item.label}
                          {item.to === '/sales/tasks' && tasksDue > 0 && (
                            <span className="ml-auto min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-semibold tabular-nums text-accent-foreground" aria-label={`${tasksDue} due`}>
                              {tasksDue}
                            </span>
                          )}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </nav>

      <div className="relative shrink-0 border-t border-border px-3 pt-2 pb-3 safe-b flex flex-col gap-1.5" ref={menuRef}>
        <UsageStrip usage={usage} status={status} onNavigate={onClose} />
        {(status?.senderHealth?.level === 'critical' || status?.senderHealth?.level === 'warning') && (
          <Link
            to="/settings"
            search={{ tab: 'verification' }}
            onClick={onClose}
            className={`flex items-center gap-1 px-1 text-[11px] font-semibold hover:underline ${
              status.senderHealth.level === 'critical' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            <AlertTriangle className="w-3 h-3 shrink-0" />
            {status.senderHealth.level !== 'critical'
              ? 'Verification setup needs attention'
              : status.senderHealth.problem === 'domain'
                ? 'Verification domain is blocklisted'
                : 'Verification IP needs replacing'}
          </Link>
        )}

        {menuOpen && (
          <div role="menu" aria-label="Account" className="absolute bottom-full left-3 right-3 mb-1 z-10 rounded-md-m border border-border bg-card shadow-lg p-2 flex flex-col gap-1">
            {email && <p className="px-2 pt-1 text-xs text-muted-foreground truncate" title={email}>{email}</p>}
            {hasAllowance ? (
              <div className="px-2 py-2">
                <AllowanceMeter />
              </div>
            ) : (
              status && (
                <div className="px-2 py-1 text-xs text-muted-foreground flex flex-col gap-0.5">
                  {status.socialfetch.configured && !status.socialfetch.balanceHidden && <span>Each search uses 3 SocialFetch credits.</span>}
                  {!status.managed && <span>Email verification: {status.verification.provider === 'reacher' ? 'on' : 'off (best guess only)'}</span>}
                </div>
              )
            )}
            <div className="border-t border-border my-1" />
            <Link
              to="/settings"
              role="menuitem"
              onClick={go}
              className="flex items-center gap-3 px-2 py-1.5 text-sm text-foreground rounded-md-s hover:bg-muted transition-colors"
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 px-2 py-1.5 text-sm text-foreground rounded-md-s hover:bg-destructive/10 hover:text-destructive transition-colors text-left cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`flex w-full items-center gap-2.5 rounded-md-s border px-2 py-1.5 text-left transition-colors cursor-pointer ${
            menuOpen ? 'border-border bg-muted' : 'border-transparent hover:border-border hover:bg-muted'
          }`}
        >
          <Avatar name={email ? email.split('@')[0].replace(/[._-]+/g, ' ') : 'Account'} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{email || 'Account'}</span>
          <ChevronsUpDown className="w-4 h-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </aside>
  )
}
