/**
 * The MagpieCRM bird, drawn with theme colours so it follows light/dark mode.
 * Same mark as the marketing site and public/favicon.svg.
 */
export function MagpieLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path d="M3 27 11 17.5 14 20.5Z" fill="var(--foreground)" />
      <ellipse cx="17" cy="15.5" rx="8" ry="5.8" transform="rotate(-28 17 15.5)" fill="var(--foreground)" />
      <circle cx="23" cy="8.5" r="4.2" fill="var(--foreground)" />
      <path d="M26.8 7.4 30.5 8.6 26.8 9.9Z" fill="var(--foreground)" />
      <ellipse cx="17.5" cy="17.8" rx="4.6" ry="2.6" transform="rotate(-28 17.5 17.8)" fill="var(--card)" />
      <path d="M12.5 14.2Q17 11.5 21 12.8 17 15 13.5 16.2Z" fill="var(--accent)" />
      <circle cx="24" cy="7.8" r="0.9" fill="var(--card)" />
    </svg>
  )
}

/** Bird plus the "MagpieCRM" wordmark, as in the website header. */
export function MagpieWordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
      <MagpieLogo />
      <span>
        Magpie<span className="font-medium text-muted-foreground">CRM</span>
      </span>
    </span>
  )
}
