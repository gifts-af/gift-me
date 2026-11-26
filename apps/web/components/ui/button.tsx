"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

// Sizes and shapes from design/ui.md: 12 px rounding, 48 px main buttons,
// 44 px small ones (the minimum tap target), borders rather than shadows.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // The edge is about 3:1 against the page in both themes (WCAG 1.4.11),
        // so an outline button still reads as something to tap.
        outline:
          "border border-foreground/50 dark:border-foreground/35 bg-background hover:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "hover:bg-muted",
        link: "font-normal text-muted-foreground underline underline-offset-[3px] hover:text-foreground",
      },
      size: {
        default: "min-h-12 px-5 text-base",
        sm: "min-h-11 px-3.5 text-[15px]",
        lg: "min-h-12 px-8 text-base",
        icon: "h-11 w-11 rounded-md [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const hydrated = useHydrated();
    if (asChild) {
      // Usually a link, which works before the page's JavaScript has loaded.
      return <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
    }
    // A button in the server's HTML shows before React attaches its click
    // handler, and a tap in that gap does nothing (ALL-104, ALL-110). Until
    // then it looks not ready. A submit button is disabled, so an early tap
    // can't send its form the browser's own way (ALL-60); any other button
    // gets aria-disabled, so a keyboard can still reach it.
    const early = !hydrated;
    // No type means submit, as the browser treats it.
    const submit = props.type !== "button" && props.type !== "reset";
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        disabled={props.disabled || (early && submit)}
        aria-disabled={props["aria-disabled"] ?? (early && !submit ? true : undefined)}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
