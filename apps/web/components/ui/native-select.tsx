"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

// The browser's own <select>, styled to match Input on every phone: iPhone
// Safari otherwise draws it grey next to white text boxes (ALL-109). The
// browser's own picker still opens, which is the easiest one to use on a phone.
// `className` styles the <select> itself; to size it, size a box around it.
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(({ className, ...props }, ref) => {
  // Off until the page has loaded when its value lives in state, as Input is.
  const hydrated = useHydrated();
  const early = !hydrated && props.value !== undefined;
  return (
    <div className="relative w-full">
      <select
        ref={ref}
        className={cn(
          "peer flex min-h-11 w-full appearance-none rounded-md border border-input bg-background py-2.5 pl-3 pr-9 text-base font-normal text-foreground aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
        disabled={props.disabled || early}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
      />
    </div>
  );
});
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
