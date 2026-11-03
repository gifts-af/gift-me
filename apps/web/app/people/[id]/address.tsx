"use client";

import { useEffect, useRef, useState } from "react";
import { splitRecipientName, US_STATES, type AddressDraft, type AddressField } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AddressSaveResult, PersonAddress, SaveResult } from "@/modules/concierge";

type Errors = Partial<Record<AddressField, string>>;
type Values = Record<AddressField, string>;

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

function startValues(name: string, address: PersonAddress): Values {
  if (address.kind === "own") {
    const a = address.address;
    const v = (k: AddressField) => a[k] ?? "";
    return { firstName: v("firstName"), lastName: v("lastName"), line1: v("line1"), line2: v("line2"), city: v("city"), state: v("state"), zip: v("zip") };
  }
  return { ...splitRecipientName(name), line1: "", line2: "", city: "", state: "", zip: "" };
}

/**
 * A person's shipping address (ALL-81): below Budgets, optional until a round
 * needs it. Opens straight away from the "Add an address" email. A list
 * owner's shared address is read-only and shows only city and state.
 */
export function AddressSection({
  personId,
  name,
  address,
  startOpen,
  saveAction,
  removeAction,
}: {
  personId: string;
  name: string;
  address: PersonAddress;
  startOpen: boolean;
  /** `saveAddressAction` */
  saveAction: (previous: null, formData: FormData) => Promise<AddressSaveResult>;
  /** `removeAddressAction` */
  removeAction: (previous: null, formData: FormData) => Promise<SaveResult>;
}) {
  const shared = address.kind === "shared";
  const [editing, setEditing] = useState(startOpen && !shared);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    if (startOpen) section.current?.scrollIntoView?.({ block: "start" });
  }, [startOpen]);

  return (
    <section
      ref={section}
      id="address"
      className="flex scroll-mt-4 flex-col gap-2"
      aria-labelledby="address-heading"
    >
      <h2 id="address-heading" className="text-lg font-semibold">
        Shipping address
      </h2>
      {address.kind === "shared" ? (
        <p className="text-[13px] text-muted-foreground">
          Gifts ship to {name}&apos;s own address in {address.city}, {address.state}. They keep it up to date.
        </p>
      ) : editing ? (
        <AddressForm
          personId={personId}
          start={startValues(name, address)}
          startErrors={address.kind === "own" ? address.problems : {}}
          saveAction={saveAction}
          onDone={() => setEditing(false)}
        />
      ) : address.kind === "own" ? (
        <SavedAddress
          personId={personId}
          name={name}
          address={address.address}
          incomplete={Object.keys(address.problems).length > 0}
          onChange={() => setEditing(true)}
          removeAction={removeAction}
        />
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">Optional for now. We&apos;ll ask before their first gift ships.</p>
          <Button type="button" variant="outline" className="self-start" onClick={() => setEditing(true)}>
            Add an address
          </Button>
        </>
      )}
    </section>
  );
}

function AddressForm({
  personId,
  start,
  startErrors,
  saveAction,
  onDone,
}: {
  personId: string;
  start: Values;
  startErrors: Errors;
  saveAction: (previous: null, formData: FormData) => Promise<AddressSaveResult>;
  onDone: () => void;
}) {
  const [values, setValues] = useState(start);
  const [errors, setErrors] = useState<Errors>(startErrors);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("id", personId);
    for (const f of FIELDS) form.set(f.key, values[f.key]);
    let result: AddressSaveResult;
    try {
      result = await saveAction(null, form);
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
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {FIELDS.map((f) => {
        const id = `address-${f.key}`;
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
          Save address
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SavedAddress({
  personId,
  name,
  address,
  incomplete,
  onChange,
  removeAction,
}: {
  personId: string;
  name: string;
  address: AddressDraft;
  incomplete: boolean;
  onChange: () => void;
  removeAction: (previous: null, formData: FormData) => Promise<SaveResult>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const who = [address.firstName, address.lastName].filter(Boolean).join(" ");
  const street = [address.line1, address.line2].filter(Boolean).join(", ");
  const place = [[address.city, address.state].filter(Boolean).join(", "), address.zip].filter(Boolean).join(" ");

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("id", personId);
    let result: SaveResult;
    try {
      result = await removeAction(null, form);
    } catch {
      result = { ok: false, error: TRY_AGAIN };
    }
    setBusy(false);
    if (result.ok) setOpen(false);
    else setError(result.error);
  }

  return (
    <>
      <div className="rounded-xl border border-border p-3 text-[15px]">
        {who && <p>{who}</p>}
        {street && <p>{street}</p>}
        {place && <p>{place}</p>}
      </div>
      {incomplete && (
        <p className="text-[13px] text-muted-foreground">Something&apos;s missing. Change the address to fix it.</p>
      )}
      <div className="flex items-center justify-between">
        <Button type="button" variant="link" className="px-0 text-primary" onClick={onChange}>
          Change address
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="link" className="px-0 text-muted-foreground">
              Remove
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove {name}&apos;s address?</DialogTitle>
              <DialogDescription>We&apos;ll ask for it again before their next gift.</DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-[13px] text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
                Remove address
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
