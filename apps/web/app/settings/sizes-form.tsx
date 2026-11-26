"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SizeItem } from "@/lib/account-sizes";
import { SIZE_KINDS, type SizeKind } from "@/lib/size-kinds";
import type { SizesResult } from "./sizes-actions";

type Saved = Record<SizeKind, SizeItem | null>;
type Draft = Record<SizeKind, SizeItem>;

function fromSaved(items: Saved): Draft {
  return Object.fromEntries(SIZE_KINDS.map(({ kind }) => [kind, items[kind] ?? { value: "", shared: false }])) as Draft;
}

const NOTHING = Object.fromEntries(SIZE_KINDS.map(({ kind }) => [kind, null])) as Saved;

/**
 * Your sizes and favorite color in Settings. One Save for the lot. `on` false
 * (the feature is off) leaves only Remove all.
 */
export function SizesForm({
  saved,
  on,
  saveAction,
  removeAction,
}: {
  saved: Saved;
  on: boolean;
  saveAction: (form: FormData) => Promise<SizesResult>;
  removeAction: () => Promise<SizesResult>;
}) {
  // What's been typed; null shows what's saved.
  const [edit, setEdit] = useState<Draft | null>(null);
  const draft = edit ?? fromSaved(saved);
  const hasSaved = Object.values(saved).some((item) => item !== null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SizeKind, string>>>({});
  const [busy, setBusy] = useState(false);

  // Next keeps visited routes in the page, hidden, with their state: start
  // from what's saved on coming back.
  useLayoutEffect(
    () => () => {
      setEdit(null);
      setStatus("");
      setError("");
      setFieldErrors({});
    },
    [],
  );

  async function run(action: () => Promise<SizesResult>, failed: string, done: () => void) {
    setBusy(true);
    setStatus("");
    setError("");
    setFieldErrors({});
    let result: SizesResult;
    try {
      result = await action();
    } catch {
      result = { ok: false, error: failed };
    }
    setBusy(false);
    if (result.ok) {
      done();
    } else {
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
    }
  }

  function change(kind: SizeKind, part: Partial<SizeItem>) {
    const next = { ...draft[kind], ...part };
    // An empty box can't be shared.
    if (next.value.trim() === "") next.shared = false;
    setEdit({ ...draft, [kind]: next });
    setStatus("");
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData();
        for (const { kind } of SIZE_KINDS) {
          form.set(kind, draft[kind].value);
          if (draft[kind].shared) form.set(`${kind}_shared`, "on");
        }
        void run(
          () => saveAction(form),
          "That didn't save. Try again.",
          () => setStatus("Saved"),
        );
      }}
    >
      {on && (
        <>
          <p className="text-[13px] text-muted-foreground">
            Optional. Shared ones are shown to anyone with your list link when they go to claim a gift.
          </p>
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
            {SIZE_KINDS.map(({ kind, label }) => {
              const { value, shared } = draft[kind];
              const problem = fieldErrors[kind];
              return (
                <div key={kind} className="flex flex-col gap-1.5">
                  <Label htmlFor={`size-${kind}`}>{label}</Label>
                  <div className="flex items-center gap-3">
                    <Input
                      id={`size-${kind}`}
                      value={value}
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem ? `size-${kind}-error` : undefined}
                      onChange={(event) => change(kind, { value: event.target.value })}
                    />
                    <label className="flex min-h-11 flex-none items-center gap-2 text-[15px]">
                      <Switch
                        aria-label={`Share ${label}`}
                        checked={shared}
                        disabled={value.trim() === ""}
                        onCheckedChange={(checked) => change(kind, { shared: checked })}
                      />
                      Share
                    </label>
                  </div>
                  {problem && (
                    <p id={`size-${kind}-error`} className="text-[13px] text-destructive">
                      {problem}
                    </p>
                  )}
                </div>
              );
            })}
          </fieldset>
        </>
      )}
      <div className="flex gap-2">
        {on && (
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        )}
        {hasSaved && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(removeAction, "That didn't work. Try again.", () => {
                setEdit(fromSaved(NOTHING));
                setStatus("Removed");
                statusRef.current?.focus(); // the focused button goes
              })
            }
          >
            Remove all
          </Button>
        )}
      </div>
      <p role="status" ref={statusRef} tabIndex={-1} className="text-[13px] text-success">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
