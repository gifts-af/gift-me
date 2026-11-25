"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { DateFields } from "@/app/people/person-form";
import { Button } from "@/components/ui/button";
import type { Birthday } from "@/lib/account-birthday";
import type { SaveResult } from "@/modules/concierge";

/**
 * Your own birthday in Settings. One Save, since a month and a day only mean
 * something together. `on` false (the feature is off) leaves only Remove.
 */
export function BirthdayForm({
  saved,
  on,
  saveAction,
  removeAction,
}: {
  saved: Birthday | null;
  on: boolean;
  saveAction: (form: FormData) => Promise<SaveResult>;
  removeAction: () => Promise<SaveResult>;
}) {
  // What's been typed; null shows what's saved.
  const [edit, setEdit] = useState<{ month: string; day: string } | null>(null);
  const { month, day } = edit ?? { month: String(saved?.month ?? ""), day: String(saved?.day ?? "") };
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Next keeps visited routes in the page, hidden, with their state: start
  // from what's saved on coming back.
  useLayoutEffect(
    () => () => {
      setEdit(null);
      setStatus("");
      setError("");
    },
    [],
  );

  async function run(action: () => Promise<SaveResult>, failed: string, done: () => void) {
    setBusy(true);
    setStatus("");
    setError("");
    let result: SaveResult;
    try {
      result = await action();
    } catch {
      result = { ok: false, error: failed };
    }
    setBusy(false);
    if (result.ok) done();
    else setError(result.error);
  }

  function change(part: { month?: string; day?: string }) {
    setEdit({ month, day, ...part });
    setStatus("");
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
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
            Optional. Anyone signed in with your list link can see this when they add you. People who already added it
            keep it.
          </p>
          <fieldset disabled={busy} className="min-w-0">
            <DateFields
              name="birthday"
              label="Birthday"
              month={month}
              day={day}
              onMonth={(value) => change({ month: value })}
              onDay={(value) => change({ day: value })}
            />
          </fieldset>
        </>
      )}
      <div className="flex gap-2">
        {on && (
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        )}
        {saved && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(removeAction, "That didn't work. Try again.", () => {
                setEdit({ month: "", day: "" });
                setStatus("Removed");
                statusRef.current?.focus(); // the focused button goes
              })
            }
          >
            Remove
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
