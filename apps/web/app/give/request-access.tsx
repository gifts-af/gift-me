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

  // Set by an answer to the tap made here, so focus moves once for it.
  const focusSent = useRef(false);
  useEffect(() => {
    if (!focusSent.current) return;
    focusSent.current = false;
    sentRef.current?.focus();
  }, [status]);

  // Next.js keeps a page you leave in a hidden <Activity>, which runs effect
  // cleanups. Its messages go, and an answer still on its way is dropped; the
  // re-read page says whether it was sent.
  const visit = useRef(0);
  useEffect(
    () => () => {
      visit.current += 1;
      setStatus(null);
    },
    [],
  );

  function send() {
    const asked = visit.current;
    setStatus(null);
    startTransition(async () => {
      let answer: Status = "error";
      try {
        answer = (await action()).status;
      } catch {
        // It couldn't be reached.
      }
      if (asked !== visit.current) return;
      focusSent.current = answer === "sent";
      setStatus(answer);
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
