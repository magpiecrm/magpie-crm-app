interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** What it switches, for screen readers when there's no visible label tied to it. */
  label: string
  disabled?: boolean
  id?: string
}

/** An on/off switch. */
export function Switch({ checked, onChange, label, disabled = false, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-70 ${
        // Off, the track carries an edge at 3:1, so the switch can be seen at all (WCAG 1.4.11).
        checked ? 'bg-accent' : 'bg-foreground/[0.12] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-foreground)_50%,transparent)]'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-foreground)_35%,transparent)]'
        }`}
      />
    </button>
  )
}
