import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../queryKeys'
import { AlertTriangle, Mail, BarChart3, Search, Users, Loader2, MessageSquare, Contact, LogOut, Settings, FileText, UserCircle, X, ClipboardList, LayoutTemplate } from 'lucide-react'
import { clearAuthCookie } from '../../utils/auth'

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
  const handleSignOut = () => {
    clearAuthCookie()
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
        <div className="w-40 text-foreground">
          <svg 
            version="1.1" 
            id="Layer_1" 
            xmlns="http://www.w3.org/2000/svg" 
            xmlnsXlink="http://www.w3.org/1999/xlink" 
            x="0px" 
            y="0px"
            width="100%" 
            viewBox="0 0 813 163" 
            enableBackground="new 0 0 813 163" 
            xmlSpace="preserve"
            className="text-foreground"
          >
            {/* V (Left Leg) - Brand Accent Blue */}
            <path fill="var(--accent)" opacity="1.000000" stroke="none" 
              d="M69.652023,79.412888 C63.338707,65.513092 57.200554,51.948250 50.736660,37.663536 C58.884254,37.663536 66.319687,37.555347 73.744286,37.789936 C74.760239,37.822037 76.148262,39.378742 76.646469,40.537960 C87.141571,64.957710 97.546944,89.416107 107.901939,113.895676 C108.371346,115.005363 108.687286,116.591690 108.254173,117.605446 C105.142120,124.889534 101.817703,132.082901 98.560684,139.305054 C98.028206,139.402267 97.495728,139.499481 96.963249,139.596695 C87.917892,119.647072 78.872536,99.697449 69.652023,79.412888 Z" 
            />

            {/* V (Right Leg) - Theme Aware */}
            <path fill="currentColor" opacity="1.000000" stroke="none" 
              d="M113.451843,82.593727 C107.487045,73.594597 108.243866,65.144104 113.408447,56.374962 C116.170547,51.685093 117.999367,46.419998 119.996475,41.315556 C121.049965,38.622944 122.504013,37.436836 125.520866,37.547520 C131.600372,37.770550 137.693802,37.613930 144.699722,37.613930 C135.906891,56.930241 127.548088,75.293091 118.717705,94.691910 C116.717209,90.078506 115.168549,86.507088 113.451843,82.593727 Z" 
            />

            {/* E - Theme Aware */}
            <path fill="currentColor" opacity="1.000000" stroke="none" 
              d="M193.696045,60.123856 C193.693359,65.756683 193.693359,70.903488 193.693359,76.638641 C208.697464,76.638641 223.275299,76.638641 238.716034,76.638641 C238.716034,82.109344 238.953262,87.045036 238.511230,91.919121 C238.425201,92.867798 235.708481,94.260811 234.184875,94.287437 C222.691315,94.488304 211.185867,94.629913 199.698853,94.291107 C194.825058,94.147354 193.241821,95.670715 193.603043,100.478676 C193.997025,105.722801 193.692551,111.019386 193.692551,116.772797 C211.524887,116.772797 228.622787,116.772797 246.065948,116.772797 C246.065948,123.003418 246.065948,128.727768 246.065948,134.627472 C221.114258,134.627472 196.513016,134.627472 171.532776,134.627472 C171.532776,102.487206 171.532776,70.594513 171.532776,38.255669 C195.740799,38.255669 219.919235,38.255669 244.413055,38.255669 C244.413055,44.014050 244.413055,49.585743 244.413055,55.857426 C240.378159,55.857426 236.605743,55.857162 232.833328,55.857468 C221.169647,55.858414 209.505417,55.921917 197.842712,55.815754 C195.012451,55.789993 193.271072,56.394478 193.696045,60.123856 Z" 
            />

            {/* R - Theme Aware */}
            <path fill="currentColor" opacity="1.000000" stroke="none" 
              d="M307.785828,132.541367 C307.095795,133.602737 306.444275,134.718719 305.770966,134.732071 C299.145264,134.863327 292.515930,134.811340 285.524872,134.811340 C285.524872,102.471664 285.524872,70.579140 285.524872,38.708328 C285.822723,38.479614 286.079224,38.110718 286.330566,38.114204 C304.122833,38.361076 322.092987,37.160423 339.661987,39.281166 C362.235718,42.006027 374.162537,62.108021 367.995178,83.342316 C365.752319,91.064545 361.044342,96.881737 354.282196,101.115036 C352.907776,101.975449 351.530518,102.831299 349.749329,103.941940 C356.816559,114.106125 363.697540,124.002441 371.233887,134.841339 C362.973297,134.841339 355.886627,134.982986 348.815887,134.711014 C347.540222,134.661957 346.017731,133.135727 345.141418,131.910736 C340.296112,125.137245 335.489197,118.328278 330.942017,111.353546 C329.171570,108.637909 327.164673,107.632713 323.975555,107.789474 C318.854553,108.041199 313.712097,107.856979 307.814240,107.856979 C307.814240,116.223572 307.814240,124.153931 307.785828,132.541367 M332.471954,56.706394 C324.415863,56.706394 316.359802,56.706394 308.215240,56.706394 C308.215240,67.695053 308.215240,78.554665 308.215240,89.431580 C316.368347,89.431580 324.206665,90.112022 331.874481,89.259224 C341.444885,88.194832 346.395020,82.232780 346.693054,73.432777 C346.983429,64.858887 342.637421,59.473236 332.471954,56.706394 Z" 
            />

            {/* I - Theme Aware */}
            <path fill="currentColor" opacity="1.000000" stroke="none" 
              d="M430.445862,66.000191 C430.445648,87.315636 430.293671,108.132980 430.556610,128.945099 C430.618622,133.853363 429.087463,135.315796 424.351776,134.953766 C419.231476,134.562347 414.058105,134.865158 408.455994,134.865158 C408.455994,102.578178 408.455994,70.572586 408.455994,38.192261 C415.464111,38.192261 422.516327,38.192261 430.445648,38.192261 C430.445648,47.343475 430.445648,56.421829 430.445862,66.000191 Z" 
            />

            {/* T - Theme Aware */}
            <path fill="currentColor" opacity="1.000000" stroke="none" 
              d="M475.023315,56.049713 C463.167542,56.049595 463.167847,56.049595 463.179657,44.430355 C463.181641,42.470703 463.179901,40.511051 463.179901,38.183617 C491.571960,38.183617 519.433838,38.183617 547.625732,38.183617 C547.625732,43.913628 547.625732,49.502102 547.625732,55.858917 C537.639343,55.858917 527.612732,55.858917 516.973877,55.858917 C516.973877,82.481941 516.973877,108.352470 516.973877,134.544556 C509.272369,134.544556 502.191071,134.544556 494.441467,134.544556 C494.441467,108.622688 494.441467,82.743141 494.441467,56.049698 C487.710114,56.049698 481.614105,56.049698 475.023315,56.049713 Z" 
            />

            {/* L - Theme Aware */}
            <path fill="currentColor" opacity="1.000000" stroke="none" 
              d="M619.007690,116.602722 C630.117737,116.602570 640.729248,116.602570 651.639526,116.602570 C651.639526,122.834274 651.639526,128.428787 651.639526,134.447876 C628.251221,134.447876 604.893188,134.447876 581.187378,134.447876 C581.187378,102.433907 581.187378,70.542374 581.187378,38.233597 C588.260864,38.233597 595.312256,38.233597 603.034729,38.233597 C603.034729,64.097313 603.034729,89.967430 603.034729,116.602882 C608.620605,116.602882 613.564819,116.602882 619.007690,116.602722 Z" 
            />

            {/* Y - Theme Aware */}
            <path fill="currentColor" opacity="1.000000" stroke="none" 
              d="M709.285583,131.585327 C709.208740,120.795601 711.164612,109.905708 708.501160,100.296143 C705.839783,90.693817 698.586121,82.354645 693.291077,73.494339 C686.386902,61.941452 679.429016,50.420666 671.893250,37.886333 C680.037109,37.886333 687.248840,37.737144 694.441772,38.037212 C695.603394,38.085674 696.953796,39.966572 697.755737,41.281693 C704.607910,52.518814 711.347717,63.824360 718.137695,75.099503 C719.137451,76.759560 720.223999,78.367340 721.677246,80.633850 C728.050964,70.042786 734.842163,60.457226 739.814453,50.006302 C744.558472,40.035236 751.066589,35.738594 761.880737,37.754616 C763.959900,38.142227 766.173218,37.810284 769.262695,37.810284 C768.067078,39.989437 767.284302,41.538464 766.392822,43.022167 C756.267761,59.873875 746.244141,76.788559 735.911316,93.512100 C733.086609,98.083740 731.599365,102.577606 731.827698,108.005531 C732.191223,116.647095 731.924744,125.315155 731.924744,134.816666 C724.902344,134.816666 718.148743,134.901001 711.403931,134.695160 L710.674133,134.672882 L709.285583,131.585327 Z" 
             />
          </svg>
        </div>
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
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 px-2">
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
                          ? 'bg-accent/10 text-accent font-medium'
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
                        className: 'bg-accent/10 text-accent font-medium',
                      }}
                      className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground rounded-md-s hover:bg-muted transition-colors md-state-hover"
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
        <div className="bg-accent/5 rounded-md-m p-4 border border-accent/10">
          <p className="text-[10px] text-accent mb-2 font-bold uppercase tracking-wider">SocialFetch Credits</p>
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
              <span className="text-xl font-display text-foreground">
                {status.socialfetch.balance.toLocaleString()}
              </span>
              <span className="text-[10px] text-muted-foreground">3 / search</span>
            </div>
          )}
          {/* Optional chaining: a status fetched before this field existed
              (e.g. across a hot reload) mustn't crash the sidebar. */}
          {status?.neverbounce?.configured && (
            <div className="mt-3 pt-3 border-t border-accent/10">
              <p className="text-[10px] text-accent mb-1 font-bold uppercase tracking-wider">
                NeverBounce Credits{!status.neverbounce.inUse && <span className="font-normal normal-case text-muted-foreground"> (not in use)</span>}
              </p>
              {status.neverbounce.credits === null ? (
                <p className="text-xs text-muted-foreground">Unavailable</p>
              ) : (
                <div className="flex justify-between items-baseline">
                  <span className="text-xl font-display text-foreground">{status.neverbounce.credits.toLocaleString()}</span>
                  <span className="text-[10px] text-muted-foreground">1 / check</span>
                </div>
              )}
            </div>
          )}
          {status && (
            <p className="text-[10px] text-muted-foreground mt-2">
              Email verification:{' '}
              {status.verification.provider === 'reacher'
                ? 'Reacher'
                : status.verification.provider === 'neverbounce'
                  ? 'NeverBounce'
                  : 'off (best guess only)'}
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
              {status.senderHealth.level === 'critical' ? 'Verification IP needs replacing' : 'Verification setup needs attention'}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2 mt-4">
          <Link
            to="/settings"
            onClick={onClose}
            activeProps={{ className: 'bg-accent/10 text-accent' }}
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
