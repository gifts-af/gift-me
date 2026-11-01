"use client";

import { useCallback, useState } from "react";
import { RequestAccessForm } from "@/app/request-access/request-access-form";
import {
  CLOSE_AFTER_SENT_MS,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { APP_NAME } from "@/lib/brand";

// "Request access" opens the ALL-47 form over the page (ALL-53), so asking
// doesn't feel like leaving for a separate "email me" page.
export function RequestAccessButton({
  className,
  children = "Request access",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const closeSoon = useCallback(() => {
    setTimeout(() => setOpen(false), CLOSE_AFTER_SENT_MS);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={className}>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Want in?</DialogTitle>
          <DialogDescription>
            {APP_NAME} is invite only while it&apos;s in early alpha. Leave your name and email and we&apos;ll let you in.
          </DialogDescription>
        </DialogHeader>
        <RequestAccessForm onSent={closeSoon} />
      </DialogContent>
    </Dialog>
  );
}
