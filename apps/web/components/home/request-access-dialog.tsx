"use client";

import { RequestAccessForm } from "@/app/request-access/request-access-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useSelfClosingDialog,
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
  const { open, onOpenChange, closeSoon } = useSelfClosingDialog();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
