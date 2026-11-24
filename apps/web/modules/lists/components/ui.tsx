// Small presentational pieces shared by the list screens, in the design/ui.md
// look. Behaviour stays in the components that use them.

import type { HTMLAttributes, ReactNode } from "react";

export type BannerTone = "muted" | "accent" | "error" | "warn";

export type BannerProps = {
  tone?: BannerTone;
  role?: HTMLAttributes<HTMLDivElement>["role"];
  className?: string;
  children?: ReactNode;
};

export function Banner({ tone = "muted", role, className = "", children }: BannerProps) {
  const tones: Record<BannerTone, string> = {
    muted: "bg-muted text-foreground",
    accent: "bg-accent text-accent-foreground",
    error: "bg-muted text-destructive",
    warn: "bg-warning-soft text-warning",
  };
  return (
    <div role={role} className={`rounded-lg p-3 text-sm ${tones[tone]} ${className}`}>
      {children}
    </div>
  );
}

export type BlockedButtonProps = {
  id: string;
  reason: ReactNode;
  className?: string;
  children?: ReactNode;
};

// A control that can't be used yet, with the reason in a tooltip. Uses
// aria-disabled rather than disabled: a disabled button gets no hover or
// focus events, so the reason could never appear.
export function BlockedButton({ id, reason, className = "", children }: BlockedButtonProps) {
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
  );
}

export const inputClass =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base aria-[invalid=true]:border-destructive";

export const labelClass = "text-sm font-semibold";
