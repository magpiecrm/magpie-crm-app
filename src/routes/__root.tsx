import { HeadContent, Scripts, Outlet, createRootRouteWithContext, redirect, useLocation } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { MessageSquare, Menu } from 'lucide-react'
import { queryClient } from '../queryClient'
import { Sidebar } from '../components/Layout/Sidebar'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { AIChat } from '../features/copilot/components/AIChat'
import { ThemeToggle } from '../components/ui/ThemeToggle'
import { NotificationBell } from '../components/NotificationBell'
import { isAuthenticated } from '../utils/auth'
import { isPublicPath } from '../utils/publicRoutes'
import { checkAuthFn } from '../server/functions'
import { copilotStore } from '../features/copilot/copilotStore'

import appCss from '../styles.css?url'
import { APP_NAME } from '../brand'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRouteWithContext<{
  queryClient: typeof queryClient
}>()({
  beforeLoad: async ({ location }) => {
    // Public pages must never bounce respondents to the login screen.
    if (isPublicPath(location.pathname)) return

    let isAuth = false
    if (typeof document !== 'undefined') {
      isAuth = isAuthenticated()
    } else {
      try {
        const res = await checkAuthFn()
        isAuth = res.isAuthenticated
      } catch (e) {
        isAuth = false
      }
    }
    const isLoginPage = location.pathname === '/login'

    if (!isAuth && !isLoginPage) {
      throw redirect({
        to: '/login',
      })
    }

    if (isAuth && isLoginPage) {
      throw redirect({
        to: '/collection',
      })
    }
  },
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        title: APP_NAME,
      },
      // iOS only treats the site as an installable app — and only allows web
      // push — when it is added to the Home Screen with these present.
      {
        name: 'apple-mobile-web-app-capable',
        content: 'yes',
      },
      // `black-translucent` draws the page *under* the status bar. Nothing ever
      // applied the matching top inset, so the header — and the hamburger in
      // it — sat behind the clock and was unreachable. `default` keeps the web
      // view below the status bar instead.
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'default',
      },
      {
        name: 'apple-mobile-web-app-title',
        content: APP_NAME,
      },
      // Tints the surrounding browser/OS chrome to match the active theme, so a
      // light-theme user does not get a dark band above a white header.
      {
        name: 'theme-color',
        media: '(prefers-color-scheme: light)',
        content: '#FFFFFF',
      },
      {
        name: 'theme-color',
        media: '(prefers-color-scheme: dark)',
        content: '#0B0F1A',
      },
    ],
    links: [
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/favicon.svg',
      },
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
      {
        rel: 'apple-touch-icon',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  component: RootDocument,
})

function RootDocument() {
  const location = useLocation()
  const isLoginPage = location.pathname === '/login'
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [chatWidth, setChatWidth] = useState(384)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartRef = useRef({ startX: 0, startWidth: 0 })
  const isDesktop = useIsDesktop()

  // Below `lg` the chat is a full-screen overlay, so it must not push `main`.
  const contentOffset = isDesktop && isChatOpen ? `${chatWidth}px` : '0px'

  // The drawer is transient — a navigation always dismisses it.
  useEffect(() => {
    setIsSidebarOpen(false)
  }, [location.pathname])

  const personaContext = useSyncExternalStore(copilotStore.subscribe, () => copilotStore.personaContext, () => null)
  const onPersonaAction = useSyncExternalStore(copilotStore.subscribe, () => copilotStore.onPersonaAction, () => null)

  const startResizing = (e: React.PointerEvent) => {
    e.preventDefault()
    dragStartRef.current = {
      startX: e.clientX,
      startWidth: chatWidth
    }
    setIsResizing(true)
  }

  const stopResizing = () => {
    setIsResizing(false)
  }

  const resize = (e: PointerEvent) => {
    const { startX, startWidth } = dragStartRef.current
    const deltaX = e.clientX - startX
    const newWidth = startWidth - deltaX
    const clampedWidth = Math.max(350, Math.min(800, newWidth))
    setChatWidth(clampedWidth)
  }

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('pointermove', resize)
      window.addEventListener('pointerup', stopResizing)
      window.addEventListener('pointercancel', stopResizing)
    }
    return () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
    }
  }, [isResizing])

  if (isPublicPath(location.pathname)) {
    // Bare, scrollable document: no app chrome, no theme script (the survey
    // carries its own colours), nothing that calls authenticated endpoints.
    return (
      <html lang="en">
        <head>
          <HeadContent />
        </head>
        <body>
          <QueryClientProvider client={queryClient}>
            <Outlet />
            <Scripts />
          </QueryClientProvider>
        </body>
      </html>
    )
  }

  if (isLoginPage) {
    return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
          <HeadContent />
        </head>
        <body className="h-[100dvh] overflow-hidden">
          <QueryClientProvider client={queryClient}>
            <div className="min-h-[100dvh] bg-background">
              <Outlet />
            </div>
            <Scripts />
          </QueryClientProvider>
        </body>
      </html>
    )
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="h-[100dvh] overflow-hidden">
        <QueryClientProvider client={queryClient}>
          <div className="flex h-[100dvh] relative overflow-x-hidden">
            <Sidebar
              onToggleChat={() => setIsChatOpen(!isChatOpen)}
              isChatOpen={isChatOpen}
              isOpen={isSidebarOpen}
              onClose={() => setIsSidebarOpen(false)}
            />

            {/* Drawer backdrop (mobile only) */}
            {isSidebarOpen && (
              <div
                onClick={() => setIsSidebarOpen(false)}
                className="fixed inset-0 bg-black/50 z-40 lg:hidden animate-in fade-in duration-150"
              />
            )}

            <main
              style={{
                marginRight: contentOffset,
                transition: isResizing ? 'none' : 'margin-right 300ms cubic-bezier(0.2, 0, 0, 1)',
              }}
              className="flex-1 ml-0 lg:ml-64 h-[100dvh] overflow-y-auto flex flex-col min-w-0 custom-scrollbar"
            >
              {/* Header Navbar */}
              <header
                style={{
                  marginRight: contentOffset,
                  transition: isResizing ? 'none' : 'margin-right 300ms cubic-bezier(0.2, 0, 0, 1)',
                }}
                className="app-header border-b border-border bg-card px-4 lg:px-8 flex items-center justify-between gap-2 fixed top-0 left-0 lg:left-64 right-0 z-30"
              >
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  aria-label="Open navigation"
                  className="lg:hidden touch-target flex items-center justify-center p-2 -ml-2 text-muted-foreground hover:text-foreground rounded-md-s hover:bg-muted transition-colors"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div className="hidden lg:block text-sm font-medium text-muted-foreground">
                  {/* Left spacing */}
                </div>
                <div className="flex items-center gap-2 sm:gap-4">
                  <ThemeToggle />
                  <NotificationBell />
                  <button
                    onClick={() => setIsChatOpen(!isChatOpen)}
                    className={`flex items-center gap-2 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-md-s transition-all cursor-pointer border ${
                      isChatOpen
                        ? 'bg-accent/10 border-accent/20 text-accent hover:bg-accent/25'
                        : 'bg-muted border-border hover:bg-muted-hover text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    <span className="hidden sm:inline">AI Copilot</span>
                  </button>
                </div>
              </header>
              <div className="flex-1 min-w-0 app-header-offset">
                <Outlet />
              </div>
            </main>

            {/* AI Chat Right Sidebar Panel */}
            <aside
              style={{
                width: isDesktop ? `${chatWidth}px` : '100%',
                transform: isChatOpen ? 'translateX(0)' : 'translateX(100%)',
                transition: isResizing ? 'none' : 'transform 300ms cubic-bezier(0.2, 0, 0, 1), width 300ms cubic-bezier(0.2, 0, 0, 1)',
              }}
              className="border-l border-border bg-card fixed right-0 top-0 bottom-0 z-50 lg:z-40 shadow-sm flex safe-t"
            >
              {/* Resize Handle (Overlay touch target with custom cursor and line highlight) */}
              <div
                onPointerDown={startResizing}
                className="w-3 -left-1.5 cursor-col-resize absolute top-0 bottom-0 select-none z-50 hidden lg:flex items-center justify-center group touch-none"
              >
                {/* Inner active indicator line */}
                <div className={`w-[2px] h-full transition-colors duration-150 ${
                  isResizing ? 'bg-primary' : 'bg-transparent group-hover:bg-muted-foreground/30'
                }`} />
                
                {/* Visual grip handle */}
                <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-7 bg-card border border-border rounded-md shadow-sm flex flex-col items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 ${isResizing ? 'opacity-100 border-primary/50' : ''} transition-all duration-150 pointer-events-none z-50`}>
                  <div className="w-1 h-1 bg-muted-foreground/60 rounded-full" />
                  <div className="w-1 h-1 bg-muted-foreground/60 rounded-full" />
                  <div className="w-1 h-1 bg-muted-foreground/60 rounded-full" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <AIChat 
                  onClose={() => setIsChatOpen(false)} 
                  pageContext={location.pathname} 
                  personaContext={personaContext || undefined}
                  onPersonaAction={onPersonaAction || undefined}
                />
              </div>
            </aside>

            {/* Global drag overlay to capture mouse movements smoothly over iframes/other layout segments */}
            {isResizing && (
              <div className="fixed inset-0 cursor-col-resize z-[9999] pointer-events-auto select-none" />
            )}
          </div>
          <TanStackDevtools
            config={{
              position: 'bottom-right',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
          <Scripts />
        </QueryClientProvider>
      </body>
    </html>
  )
}
