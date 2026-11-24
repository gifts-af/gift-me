"use client";

import * as React from "react";

import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    // Text typed before the page has loaded never reaches state, and the next keystroke wipes it.
    // An input that keeps its own value (sign-in) loses nothing, so it stays on.
    const hydrated = useHydrated();
    const early = !hydrated && props.value !== undefined;
    return (
      <input
        type={type}
        className={cn(
          "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base font-normal transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
        disabled={props.disabled || early}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
