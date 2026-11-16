"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutosave } from "@/lib/use-autosave";
import type { SaveResult } from "@/modules/concierge";

/**
 * The over-budget allowance field (ALL-115). It saves as you go (`useAutosave`):
 * on blur, on Enter and when the page is left, and only when the text changed.
 */
export function OverBudgetField({ initial, action }: { initial: number; action: (value: string) => Promise<SaveResult> }) {
  const id = useId();
  const field = useAutosave({ initial: String(initial), save: action });

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
          value={field.value}
          onChange={(event) => field.setValue(event.target.value)}
          onBlur={field.onBlur}
          onKeyDown={field.onKeyDown}
          aria-describedby={`${id}-hint`}
          aria-invalid={field.error ? true : undefined}
          className="num max-w-28"
        />
        <span aria-hidden="true">%</span>
      </div>
      <p role="status" className="text-[13px] text-success">
        {field.status === "saved" ? "Saved" : ""}
      </p>
      {field.error && (
        <p role="alert" className="text-[13px] text-destructive">
          {field.error}
        </p>
      )}
    </div>
  );
}
