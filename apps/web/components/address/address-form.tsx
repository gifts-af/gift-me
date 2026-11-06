"use client";

import { useId, useState } from "react";
import { US_STATES, type AddressField } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AddressValues = Record<AddressField, string>;
type Errors = Partial<Record<AddressField, string>>;
type SaveResult = { ok: true } | { ok: false; error: string; fields?: Errors };

const SELECT_CLASS =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base font-normal";
const TRY_AGAIN = "That didn't save. Try again.";

const FIELDS: { key: AddressField; label: string; autoComplete: string; numeric?: boolean }[] = [
  { key: "firstName", label: "First name", autoComplete: "given-name" },
  { key: "lastName", label: "Last name", autoComplete: "family-name" },
  { key: "line1", label: "Street address", autoComplete: "address-line1" },
  { key: "line2", label: "Apt, suite (optional)", autoComplete: "address-line2" },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "state", label: "State", autoComplete: "address-level1" },
  { key: "zip", label: "ZIP code", autoComplete: "postal-code", numeric: true },
];

/**
 * A US address form: a person's on their page (ALL-81), or your own in Settings
 * and on the list page (ALL-63). The caller's `save` adds anything else it needs.
 */
export function AddressForm({
  start,
  startErrors = {},
  submitLabel,
  save,
  onDone,
}: {
  start: AddressValues;
  startErrors?: Errors;
  submitLabel: string;
  save: (form: FormData) => Promise<SaveResult>;
  onDone: () => void;
}) {
  // Unique per form: Next keeps visited routes in the page, hidden, so two forms can coexist.
  const formId = useId();
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<Errors>(startErrors);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    for (const f of FIELDS) form.set(f.key, values[f.key]);
    let result: SaveResult;
    try {
      result = await save(form);
    } catch {
      result = { ok: false, error: TRY_AGAIN };
    }
    setBusy(false);
    if (result.ok) {
      onDone();
      return;
    }
    setError(result.error);
    setErrors(result.fields ?? {});
  }

  const set = (k: AddressField, v: string) => setValues((old) => ({ ...old, [k]: v }));

  return (
    <form
      className="flex flex-col gap-3"
      method="post"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {FIELDS.map((f) => {
        const id = `${formId}-${f.key}`;
        const message = errors[f.key];
        const described = message ? `${id}-error` : undefined;
        return (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{f.label}</Label>
            {f.key === "state" ? (
              <select
                id={id}
                name={f.key}
                className={SELECT_CLASS}
                autoComplete={f.autoComplete}
                aria-invalid={message ? true : undefined}
                aria-describedby={described}
                value={values.state}
                onChange={(e) => set("state", e.target.value)}
              >
                <option value="">Choose…</option>
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={id}
                name={f.key}
                autoComplete={f.autoComplete}
                inputMode={f.numeric ? "numeric" : undefined}
                aria-invalid={message ? true : undefined}
                aria-describedby={described}
                value={values[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
            {message && (
              <p id={`${id}-error`} className="text-[13px] text-destructive">
                {message}
              </p>
            )}
          </div>
        );
      })}
      <p className="text-[13px] text-muted-foreground">US addresses only for now.</p>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
