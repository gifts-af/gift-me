"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

type Result = { ok: true } | { ok: false; error: string };

export function TestEmailButton({ action }: { action: () => Promise<Result> }) {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setResult(null);
    startTransition(async () => {
      setResult(await action());
    });
  }

  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-sm font-semibold">Email</h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" onClick={send} disabled={pending} aria-busy={pending} className="w-full sm:w-auto">
          {pending ? "Sending…" : "Send me a test email"}
        </Button>
        {result?.ok && (
          <p role="status" className="text-[13px] text-success">
            Sent. Check your inbox.
          </p>
        )}
        {result && !result.ok && (
          <p role="alert" className="text-[13px] text-destructive">
            {result.error}
          </p>
        )}
      </div>
    </section>
  );
}
