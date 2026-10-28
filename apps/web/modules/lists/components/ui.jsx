// Small presentational pieces shared by the list screens, in the design/ui.md
// look. Behaviour stays in the components that use them.

export function Banner({ tone = 'muted', role, className = '', children }) {
  const tones = {
    muted: 'bg-muted text-foreground',
    accent: 'bg-accent text-accent-foreground',
    error: 'bg-muted text-destructive',
    warn: 'bg-warning-soft text-warning',
  }
  return (
    <div role={role} className={`rounded-lg p-3 text-sm ${tones[tone]} ${className}`}>
      {children}
    </div>
  )
}

// A control that can't be used yet, with the reason in a tooltip. Uses
// aria-disabled rather than disabled: a disabled button gets no hover or
// focus events, so the reason could never appear.
export function BlockedButton({ id, reason, className = '', children }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className={className}
        aria-disabled="true"
        aria-describedby={id}
        onClick={(event) => event.preventDefault()}
      >
        {children}
      </button>
      <span
        id={id}
        role="tooltip"
        className="invisible absolute right-0 top-full z-10 mt-1 w-max max-w-56 rounded-md bg-foreground px-2.5 py-1.5 text-[13px] font-normal text-background shadow-md group-focus-within:visible group-hover:visible"
      >
        {reason}
      </span>
    </span>
  )
}

export const buttonClass = {
  primary:
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-45 aria-disabled:opacity-45',
  secondary:
    'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-secondary px-5 text-base font-semibold text-secondary-foreground hover:bg-secondary/70 disabled:opacity-45 aria-disabled:opacity-45',
  secondarySm:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-secondary px-3.5 text-[15px] font-semibold text-secondary-foreground hover:bg-secondary/70 disabled:opacity-45 aria-disabled:opacity-45',
  primarySm:
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-45 aria-disabled:opacity-45',
  link: 'inline-flex min-h-11 items-center px-1 text-[15px] text-muted-foreground underline underline-offset-[3px] hover:text-foreground',
}

export const inputClass =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base aria-[invalid=true]:border-destructive'

export const labelClass = 'text-sm font-semibold'
