"use client";

import { useState } from "react";
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
  const [month, setMonth] = useState(saved ? String(saved.month) : "");
  const [day, setDay] = useState(saved ? String(saved.day) : "");
  const [has, setHas] = useState(saved !== null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  function change(set: (value: string) => void) {
    return (value: string) => {
      set(value);
      setStatus("");
    };
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
          () => {
            setHas(true);
            setStatus("Saved");
          },
        );
      }}
    >
      <p className="text-[13px] text-muted-foreground">
        Optional. Anyone signed in with your list link can see this when they add you. People who already added it keep
        it.
      </p>
      {on && (
        <DateFields name="birthday" label="Birthday" month={month} day={day} onMonth={change(setMonth)} onDay={change(setDay)} />
      )}
      <div className="flex gap-2">
        {on && (
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        )}
        {has && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(removeAction, "That didn't work. Try again.", () => {
                setHas(false);
                setMonth("");
                setDay("");
                setStatus("Removed");
              })
            }
          >
            Remove
          </Button>
        )}
      </div>
      <p role="status" className="text-[13px] text-success">
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
