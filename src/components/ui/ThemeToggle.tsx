import { useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'

type Theme = 'light' | 'dark'

function savedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem('theme')
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

function showTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(theme)
  root.style.colorScheme = theme
}

/**
 * Switches between light and dark. The theme is put on <html> before the page
 * draws (THEME_INIT_SCRIPT in __root.tsx): the one picked here, or the system's
 * until one is. So this draws both icons and lets the `dark` class show one,
 * which reads the same on the server and in the browser, and it saves a theme
 * only when someone picks it.
 */
export function ThemeToggle() {
  // Until a theme is picked, keep following the system's.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const follow = () => {
      if (!savedTheme()) showTheme(media.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [])

  const toggleTheme = () => {
    const next: Theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
    showTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem('theme', next)
    } catch {
      // Not saved (private window): it lasts until the page is left.
    }
  }

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-md-s hover:bg-muted transition-colors md-state-hover text-muted-foreground hover:text-foreground"
      aria-label="Toggle theme"
    >
      <Moon className="w-5 h-5 dark:hidden" />
      <Sun className="hidden w-5 h-5 dark:block" />
    </button>
  )
}
