"use client";

import { useState } from "react";
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
import type { RequestKind } from "@/lib/access-request";
import { APP_NAME } from "@/lib/brand";

const COPY: Record<RequestKind, { button: string; title: string; description: string }> = {
  access: {
    button: "Request access",
    title: "Want in?",
    description: `${APP_NAME} is invite only while it's in early alpha. Leave your name and email and we'll let you in.`,
  },
  waitlist: {
    button: "Join the waitlist",
    title: "Join the waitlist",
    description: "The concierge is still being built. Leave your name and email and we'll tell you when it's ready.",
  },
};

// "Request access" opens the ALL-47 form over the page (ALL-53), so asking
// doesn't feel like leaving for a separate "email me" page. With
// kind="waitlist" it's the concierge waitlist (ALL-71), whose thank-you can
// switch the same box to Request access for the list.
export function RequestAccessButton({
  className,
  children,
  kind = "access",
}: {
  className?: string;
  children?: React.ReactNode;
  kind?: RequestKind;
}) {
  const { open, onOpenChange, closeSoon } = useSelfClosingDialog();
  const [shown, setShown] = useState<RequestKind>(kind);
  const copy = COPY[shown];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setShown(kind);
        onOpenChange(next);
      }}
    >
      <DialogTrigger className={className}>{children ?? COPY[kind].button}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {/* The waitlist's thank-you stays open, so its Request access link can be used. */}
        <RequestAccessForm
          key={shown}
          kind={shown}
          onSent={shown === "access" ? closeSoon : undefined}
          onWantAccess={() => setShown("access")}
        />
      </DialogContent>
    </Dialog>
  );
}
