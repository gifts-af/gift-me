"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

// A layer over the page (ALL-53): a sheet that slides up from the bottom on
// phones, and a box in the middle from 640 px up. Radix handles focus,
// Esc, backdrop clicks and returning focus to the button that opened it.

// How long a "thanks" stays up before the layer closes itself.
export const CLOSE_AFTER_SENT_MS = 4000;

// Open state for a layer that closes itself after a thank-you. Opening or
// closing it by hand cancels a pending close, so a layer reopened soon after
// sending stays open.
export function useSelfClosingDialog() {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = React.useCallback(() => clearTimeout(timer.current), []);
  React.useEffect(() => cancel, [cancel]);
  const onOpenChange = React.useCallback(
    (next: boolean) => {
      cancel();
      setOpen(next);
    },
    [cancel],
  );
  const closeSoon = React.useCallback(() => {
    cancel();
    timer.current = setTimeout(() => setOpen(false), CLOSE_AFTER_SENT_MS);
  }, [cancel]);
  return { open, onOpenChange, closeSoon };
}

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex max-h-[92svh] flex-col gap-4 overflow-y-auto bg-background p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-foreground shadow-2xl",
        "inset-x-0 bottom-0 rounded-t-3xl border-t data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      <div aria-hidden="true" className="mx-auto -mt-2 h-1.5 w-10 rounded-full bg-muted sm:hidden" />
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="size-5" aria-hidden="true" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 pr-10", className)} {...props} />;
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-[24px] font-extrabold leading-tight tracking-tight", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-[15px] text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger };
