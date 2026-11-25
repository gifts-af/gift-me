"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type Status = "sent" | "busy" | "error";

const PROBLEM = {
  busy: "We've had a lot of requests today. Please try again tomorrow.",
  error: "We couldn't send that just now. Please try again in a minute.",
};

// Asks for the concierge in one tap. Once sent, the page is re-read and shows
// the pitch's sent state in this button's place.
export function RequestAccessButton({ action }: { action: () => Promise<{ status: Status }> }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, startTransition] = useTransition();

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

  // Seen only if the page couldn't be re-read.
  if (status === "sent") {
    return (
      <p role="status" className="text-[16px] font-bold text-primary">
        Request sent
      </p>
    );
  }
  return (
    <>
      <Button type="button" onClick={send} disabled={pending} aria-busy={pending}>
        {pending ? "Sending…" : "Request access"}
      </Button>
      {status && (
        <p role="alert" className="text-[15px] text-destructive">
          {PROBLEM[status]}
        </p>
      )}
    </>
  );
}
