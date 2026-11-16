"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SaveResult } from "@/modules/concierge";

const TRY_AGAIN = "That didn't save. Try again.";

/**
 * The over-budget allowance field (ALL-115). It saves on blur, on Enter and when
 * the page is left, and only when the text differs from what was last sent.
 */
export function OverBudgetField({ initial, action }: { initial: number; action: (value: string) => Promise<SaveResult> }) {
  const id = useId();
  const [text, setText] = useState(String(initial));
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(text);
  const sent = useRef(String(initial));
  const visible = useRef(true);

  async function send(value: string) {
    if (value === sent.current) return;
    const prev = sent.current;
    sent.current = value;
    let result: SaveResult;
    try {
      result = await action(value);
    } catch {
      result = { ok: false, error: TRY_AGAIN };
    }
    // A failed save can be tried again, by blur, Enter or leaving.
    if (!result.ok && sent.current === value) sent.current = prev;
    if (!visible.current) {
      // Hidden while saving: a failed change goes back to what's saved, so it can't look saved on return.
      if (!result.ok) {
        current.current = prev;
        setText(prev);
      }
      return;
    }
    if (result.ok) {
      setDone(true);
      setError(null);
    } else {
      setDone(false);
      setError(result.error);
    }
  }

  // Next keeps visited routes in the page, hidden, with their state: leaving
  // sends an unsaved change and clears the tick and error.
  useLayoutEffect(() => {
    visible.current = true;
    return () => {
      visible.current = false;
      void send(current.current);
      setDone(false);
      setError(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Over-budget allowance</Label>
      <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
        When you set a budget, ideas up to this much over it are still shown, marked as over.
      </p>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="numeric"
          value={text}
          onChange={(event) => {
            current.current = event.target.value;
            setText(event.target.value);
            setDone(false);
            setError(null);
          }}
          onBlur={() => void send(text)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void send(text);
            }
          }}
          aria-describedby={`${id}-hint`}
          aria-invalid={error ? true : undefined}
          className="num max-w-28"
        />
        <span aria-hidden="true">%</span>
      </div>
      <p role="status" className="text-[13px] text-success">
        {done ? "Saved" : ""}
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
