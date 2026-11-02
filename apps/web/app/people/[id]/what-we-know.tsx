"use client";

import { useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { factLine, type FactCategory } from "@gifts-af/core";
import { Button } from "@/components/ui/button";

// "What we know" on a person's page (ALL-25, D47). Facts the buyer entered and
// the AI's suggestions from captures are kept visibly apart; AI ones can be removed.

type Fact = { id: string; category: FactCategory; value: string };
export type Knowledge = {
  told: Fact[];
  ai: (Fact & { sourceTitle: string | null; sourceUrl: string | null })[];
  unread: number;
};

type Result = { ok: true } | { ok: false; error: string };
type Action = (previous: null, formData: FormData) => Promise<Result>;

export function WhatWeKnow({
  personId,
  name,
  knowledge,
  removeAction,
  readAction,
}: {
  personId: string;
  name: string;
  knowledge: Knowledge;
  /** `removeFactAction` */
  removeAction: Action;
  /** `readCapturesAction` */
  readAction: Action;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { told, ai, unread } = knowledge;

  async function run(action: Action, fields: Record<string, string>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("personId", personId);
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    let result: Result;
    try {
      result = await action(null, form);
    } catch {
      result = { ok: false, error: "That didn't work. Try again." };
    }
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  return (
    <section className="flex flex-col gap-4 border-b border-border pb-6" aria-labelledby="know-heading">
      <h2 id="know-heading" className="text-lg font-semibold">
        What we know
      </h2>

      {told.length === 0 && ai.length === 0 && (
        <p className="text-[15px] text-muted-foreground">
          Nothing yet. Capture a page about {name} with the extension and we&apos;ll learn from it.
        </p>
      )}

      {told.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-labelledby="told-heading">
          <h3 id="told-heading" className="text-[15px] font-semibold">
            What you&apos;ve told us
          </h3>
          <ul className="flex flex-col gap-1">
            {told.map((f) => (
              <li key={f.id} className="text-[15px]">
                {factLine(f.category, f.value)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ai.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-labelledby="ai-heading">
          <h3 id="ai-heading" className="flex items-center gap-1.5 text-[15px] font-semibold">
            <Sparkles className="size-4" aria-hidden="true" />
            <span>
              <span aria-hidden="true">✨ </span>AI suggestions from your captures
            </span>
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {ai.map((f) => {
              const line = factLine(f.category, f.value);
              return (
                <li key={f.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[15px]">{line}</p>
                    {f.sourceUrl && (
                      <a
                        href={f.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-full items-center gap-1 text-[13px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        <span className="truncate">from &ldquo;{f.sourceTitle || f.sourceUrl}&rdquo;</span>
                        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={`Remove ${line}`}
                    onClick={() => void run(removeAction, { id: f.id })}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {unread > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-muted-foreground">
            {unread === 1 ? "1 capture hasn't been read." : `${unread} captures haven't been read.`}
          </p>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void run(readAction, {})}>
            {unread === 1 ? "Read it now" : "Read them now"}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
