import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { AlertTriangle, Mail, BarChart3, Search, Users, Loader2, MessageSquare, Contact, LogOut, Settings, FileText, UserCircle, X, ClipboardList, LayoutTemplate } from 'lucide-react'
import { clearAuthCookie } from '../../utils/auth'
import { MagpieWordmark } from '../ui/MagpieLogo'

const navItems = [
  {
    label: 'Data Collection',
    items: [
      { label: 'Prospect Search', to: '/collection/prospect-search', icon: Search },
      { label: 'Personas', to: '/collection/personas', icon: UserCircle },
    ],
  },
  {
    label: 'Email Marketing',
    items: [
      { label: 'Contacts', to: '/marketing/contacts', icon: Contact },
      { label: 'Campaigns', to: '/marketing/campaigns', icon: Mail },
      { label: 'Templates', to: '/marketing/templates', icon: LayoutTemplate },
      { label: 'Forms', to: '/marketing/forms', icon: FileText },
      { label: 'Surveys', to: '/marketing/surveys', icon: ClipboardList },
      { label: 'Analytics', to: '/marketing/analytics', icon: BarChart3 },
      { label: 'Lists', to: '/marketing/lists', icon: Users },
    ],
  },
  {
    label: 'AI Agent',
    items: [
      { label: 'CLI Chat', to: '/ai-chat', icon: MessageSquare },
    ],
  },
]

import { prospectingStatusFn } from '../../server/functions'

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
  const handleSignOut = () => {
    clearAuthCookie()
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

  const { data: status, isLoading: isLoadingUsage } = useQuery({
    queryKey: queryKeys.prospects.status(),
    queryFn: () => prospectingStatusFn(),
    refetchInterval: 60000, // Refresh every minute
  })

  return (
    <aside
      className={`w-64 border-r border-border bg-card fixed left-0 top-0 bottom-0 z-50 flex flex-col overflow-y-auto safe-t transition-transform duration-300 ease-out lg:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="p-6 flex items-center justify-between gap-2">
        <MagpieWordmark />
        <button
          onClick={onClose}
          aria-label="Close navigation"
          className="lg:hidden touch-target flex items-center justify-center p-2 -mr-2 text-muted-foreground hover:text-foreground rounded-md-s hover:bg-muted transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 px-4 space-y-8">
        {navItems.map((section) => (
          <div key={section.label}>
            <h2 className="font-mono text-[11px] font-medium text-muted-foreground uppercase tracking-[0.08em] mb-3 px-3">
              {section.label}
            </h2>
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.to}>
                  {item.to === '/ai-chat' ? (
                    <button
                      onClick={() => { onToggleChat?.(); onClose?.() }}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-sm rounded-md-s hover:bg-muted transition-colors md-state-hover text-left cursor-pointer ${
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
                      className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground rounded-md-s hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-border mt-auto safe-b">
        <div className="bg-background rounded-md-m p-4 border border-border">
          <p className="font-mono text-[10px] text-accent mb-2 font-medium uppercase tracking-[0.08em]">SocialFetch Credits</p>
          {isLoadingUsage ? (
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
          ) : !status?.socialfetch.configured ? (
            <Link
              to="/settings"
              search={{ tab: 'prospecting' }}
              onClick={onClose}
              className="text-xs font-semibold text-accent hover:underline"
            >
              Add your SocialFetch API key
            </Link>
          ) : status.socialfetch.balance === null ? (
            <p className="text-xs text-muted-foreground">Unavailable</p>
          ) : (
            <div className="flex justify-between items-baseline">
              <span className="text-xl font-display font-semibold tabular-nums text-foreground">
                {status.socialfetch.balance.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground">3 / search</span>
            </div>
          )}
          {status && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Email verification:{' '}
              {status.verification.provider === 'reacher' ? 'Reacher' : 'off (best guess only)'}
            </p>
          )}
          {(status?.senderHealth?.level === 'critical' || status?.senderHealth?.level === 'warning') && (
            <Link
              to="/settings"
              search={{ tab: 'prospecting' }}
              onClick={onClose}
              className={`mt-1.5 flex items-center gap-1 text-[10px] font-semibold hover:underline ${
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
        </div>
        <div className="flex items-center gap-2 mt-4">
          <Link
            to="/settings"
            onClick={onClose}
            activeProps={{ className: '!bg-muted !text-foreground' }}
            className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-muted-foreground rounded-md-s hover:bg-muted hover:text-foreground transition-colors md-state-hover border border-transparent hover:border-border cursor-pointer font-semibold shrink-0"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Link>
          <button
            onClick={handleSignOut}
            className="flex flex-1 items-center justify-center gap-2 px-3 py-2 text-sm text-muted-foreground rounded-md-s hover:bg-destructive/10 hover:text-destructive transition-colors md-state-hover border border-transparent hover:border-destructive/20 cursor-pointer font-semibold"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
