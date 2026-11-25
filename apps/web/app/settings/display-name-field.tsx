"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutosave } from "@/lib/use-autosave";
import type { SaveResult } from "@/modules/concierge";

/**
 * The name a shared list shows (ALL-136). Saves as you go (`useAutosave`): on
 * blur, on Enter and when the page is left. Empty clears it.
 */
export function DisplayNameField({ initial, action }: { initial: string | null; action: (value: string) => Promise<SaveResult> }) {
  const id = useId();
  const field = useAutosave({ initial: initial ?? "", save: action });

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Your name</Label>
      <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
        Shown on your shared list, and to anyone who opens a list you claim from.
      </p>
      <Input
        id={id}
        value={field.value}
        maxLength={80}
        autoComplete="name"
        onChange={(event) => field.setValue(event.target.value)}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
        aria-describedby={`${id}-hint`}
        aria-invalid={field.error ? true : undefined}
      />
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
