"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Status = "sent" | "busy" | "error";

const PROBLEM = {
  busy: "We've had a lot of requests today. Please try again tomorrow.",
  error: "We couldn't send that just now. Please try again in a minute.",
};

// Asks for the concierge in one tap: `ask` above the button until it's sent,
// then `sent` in their place. It stays mounted across the two, so the sent
// state can be announced and focused.
export function RequestAccess({
  action,
  requested,
  ask,
  sent,
}: {
  action: () => Promise<{ status: Status }>;
  requested: boolean;
  ask: ReactNode;
  sent: ReactNode;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, startTransition] = useTransition();
  const sentRef = useRef<HTMLDivElement>(null);
  const isSent = requested || status === "sent";

  // Only for the tap made here, not a page opened after asking.
  useEffect(() => {
    if (status === "sent") sentRef.current?.focus();
  }, [status]);

  function send() {
    setStatus(null);
    startTransition(async () => {
      try {
        setStatus((await action()).status);
      } catch {
        setStatus("error");
      }
    });
  }

  return (
    <div>
      {/* Empty until it's sent: a screen reader announces what's added to it. */}
      <div ref={sentRef} role="status" tabIndex={-1}>
        {isSent && sent}
      </div>
      {!isSent && (
        <div className="flex flex-col gap-6">
          {ask}
          <div className="flex flex-col gap-3">
            <Button type="button" onClick={send} disabled={pending} aria-busy={pending}>
              {pending ? "Sending…" : "Request access"}
            </Button>
            {status && (
              <p role="alert" className="text-[15px] text-destructive">
                {PROBLEM[status]}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
