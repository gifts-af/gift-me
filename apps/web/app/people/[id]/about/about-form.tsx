"use client";

import { useId, useState, type FocusEvent } from "react";
import { RELATIONSHIPS, relationshipLabel } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useAutosave } from "@/lib/use-autosave";
import { useHydrated } from "@/lib/use-hydrated";
import { CARD_CLASS, MONTH_NAMES, NUMBER_CLASS } from "../../person-form";

// About Mom (ALL-127, T71): who she is and her dates, each field saving on its
// own through useAutosave. No Save button. The actions are passed in, so the
// page wires the real ones and tests fake them.

type Result = { ok: true } | { ok: false; error: string };
type MonthDay = { month: number; day: number };
type Kind = "birthday" | "anniversary";

export type AboutActions = {
  /** `renamePersonAction` */
  rename: (id: string, name: string) => Promise<Result>;
  /** `setRelationshipAction` */
  setRelationship: (id: string, relationship: string) => Promise<Result>;
  /** `setDatedOccasionAction`: month and day as picked. */
  setDate: (id: string, kind: Kind, month: string, day: string) => Promise<Result>;
  /** `setBirthYearAction`: the year's text; empty clears it. */
  setBirthYear: (id: string, year: string) => Promise<Result>;
  /** `removeDatedOccasionAction` */
  removeDate: (id: string, kind: Kind) => Promise<Result>;
};

const BAD_DATE = "That date doesn't exist.";
const EMPTY_NAME = "Enter a name.";
// A leap year, so 29 February is a real birthday.
const LEAP_YEAR = 2000;

type DateText = { month: string; day: string };
const sameDate = (a: DateText, b: DateText) => a.month === b.month && a.day === b.day;
const dateText = (d: MonthDay | null): DateText => (d ? { month: String(d.month), day: String(d.day) } : { month: "", day: "" });

/** True for a whole month and day that happen in some year. The server checks again. */
function isRealDate(d: DateText): boolean {
  if (!/^\d{1,2}$/.test(d.month) || !/^\d{1,2}$/.test(d.day)) return false;
  const month = Number(d.month);
  const day = Number(d.day);
  const date = new Date(Date.UTC(LEAP_YEAR, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function Status({ saved }: { saved: boolean }) {
  return (
    <p role="status" className="min-h-4 text-[13px] text-success">
      {saved ? "Saved" : ""}
    </p>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-[13px] text-destructive">
      {error}
    </p>
  ) : null;
}

export function AboutForm({
  personId,
  name,
  relationship,
  birthday,
  birthYear,
  anniversary,
  actions,
}: {
  personId: string;
  name: string;
  relationship: string;
  birthday: MonthDay | null;
  birthYear: number | null;
  anniversary: MonthDay | null;
  actions: AboutActions;
}) {
  const hydrated = useHydrated();
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Who they are" className={CARD_CLASS}>
        <NameField personId={personId} initial={name} disabled={!hydrated} rename={actions.rename} />
        <RelationshipField
          personId={personId}
          initial={relationship}
          disabled={!hydrated}
          setRelationship={actions.setRelationship}
        />
      </section>
      <section aria-labelledby="dates-heading" className={CARD_CLASS}>
        <div className="flex items-baseline justify-between">
          <h2 id="dates-heading" className="text-base font-semibold">
            Dates
          </h2>
          <span className="text-[13px] text-muted-foreground">Optional</span>
        </div>
        <DatedField
          personId={personId}
          personName={name}
          kind="birthday"
          saved={birthday}
          birthYear={birthYear}
          disabled={!hydrated}
          actions={actions}
        />
        <div className="border-t border-border pt-4">
          <DatedField
            personId={personId}
            personName={name}
            kind="anniversary"
            saved={anniversary}
            birthYear={null}
            disabled={!hydrated}
            actions={actions}
          />
        </div>
      </section>
    </div>
  );
}

function NameField({
  personId,
  initial,
  disabled,
  rename,
}: {
  personId: string;
  initial: string;
  disabled: boolean;
  rename: AboutActions["rename"];
}) {
  const id = useId();
  // An empty name never reaches the server; the saved name stays (AC-3).
  const field = useAutosave({
    initial,
    save: (value) => (value.trim() === "" ? Promise.resolve({ ok: false, error: EMPTY_NAME }) : rename(personId, value)),
  });
  return (
    <div className="flex flex-col gap-1.5" data-testid="name-field">
      <Label htmlFor={id}>Name</Label>
      <Input
        id={id}
        autoComplete="off"
        value={field.value}
        disabled={disabled}
        onChange={(e) => field.setValue(e.target.value)}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
        aria-invalid={field.error ? true : undefined}
      />
      <ErrorLine error={field.error} />
      <Status saved={field.status === "saved"} />
    </div>
  );
}

function RelationshipField({
  personId,
  initial,
  disabled,
  setRelationship,
}: {
  personId: string;
  initial: string;
  disabled: boolean;
  setRelationship: AboutActions["setRelationship"];
}) {
  const id = useId();
  const field = useAutosave({ initial, save: (value) => setRelationship(personId, value) });
  // A relationship we no longer list still shows, as "Other", until another is picked.
  const listed = RELATIONSHIPS.some((r) => r === field.value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Who are they to you?</Label>
      <NativeSelect id={id} value={field.value} disabled={disabled} onChange={(e) => void field.commit(e.target.value)}>
        {!listed && <option value={field.value}>{relationshipLabel(field.value)}</option>}
        {RELATIONSHIPS.map((r) => (
          <option key={r} value={r}>
            {relationshipLabel(r)}
          </option>
        ))}
      </NativeSelect>
      <ErrorLine error={field.error} />
      <Status saved={field.status === "saved"} />
    </div>
  );
}

/**
 * A birthday (with its year) or an anniversary. Removing it remounts the
 * fields empty (a new key), since the hook reads its start value once.
 */
function DatedField({
  personId,
  personName,
  kind,
  saved,
  birthYear,
  disabled,
  actions,
}: {
  personId: string;
  personName: string;
  kind: Kind;
  saved: MonthDay | null;
  birthYear: number | null;
  disabled: boolean;
  actions: AboutActions;
}) {
  const label = kind === "birthday" ? "Birthday" : "Anniversary";
  const [start, setStart] = useState({ round: 0, date: dateText(saved), year: birthYear === null ? "" : String(birthYear) });
  const [hasDate, setHasDate] = useState(saved !== null);

  return (
    <fieldset className="flex flex-col gap-2">
      {/* The legend must be the fieldset's first child to name the group. */}
      <legend className="mb-1.5 p-0 text-[15px] font-semibold">{label}</legend>
      <DateInputs
        key={start.round}
        personId={personId}
        kind={kind}
        label={label}
        start={start}
        hasDate={hasDate}
        disabled={disabled}
        actions={actions}
        onSaved={() => setHasDate(true)}
      />
      {kind === "birthday" && (
        <p className="text-[13px] text-muted-foreground">
          We&apos;ll suggest gifts before it. The year is just for age-right ideas.
        </p>
      )}
      {hasDate && (
        <RemoveDate
          personId={personId}
          personName={personName}
          kind={kind}
          label={label}
          remove={actions.removeDate}
          onRemoved={() => {
            setHasDate(false);
            setStart((s) => ({ round: s.round + 1, date: dateText(null), year: "" }));
          }}
        />
      )}
    </fieldset>
  );
}

function DateInputs({
  personId,
  kind,
  label,
  start,
  hasDate,
  disabled,
  actions,
  onSaved,
}: {
  personId: string;
  kind: Kind;
  label: string;
  start: { date: DateText; year: string };
  hasDate: boolean;
  disabled: boolean;
  actions: AboutActions;
  onSaved: () => void;
}) {
  // Month and day are one value, saved together when focus leaves them, so a
  // date passed through on the way to another is never saved (AC-5). Only a
  // real date is sent; cleared or impossible ones never are (AC-6).
  const date = useAutosave<DateText>({
    initial: start.date,
    equals: sameDate,
    save: async (value) => {
      if (!isRealDate(value)) return { ok: false, error: BAD_DATE };
      const result = await actions.setDate(personId, kind, value.month, value.day);
      if (result.ok) onSaved();
      return result;
    },
  });
  const year = useAutosave({ initial: start.year, save: (value) => actions.setBirthYear(personId, value) });
  const withYear = kind === "birthday";
  const yearOn = hasDate || isRealDate(date.value);

  function leaveDate(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    // Cleared or half-filled: nothing to save. "Remove birthday" removes one.
    if (date.value.month === "" || date.value.day === "") return;
    void date.commit();
  }

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.75rem] gap-2">
        <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2" onBlur={leaveDate}>
          <NativeSelect
            aria-label={`${label} month`}
            value={date.value.month}
            disabled={disabled}
            aria-invalid={date.error ? true : undefined}
            onChange={(e) => date.setValue({ ...date.value, month: e.target.value })}
          >
            <option value="">Month</option>
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </NativeSelect>
          <Input
            aria-label={`${label} day`}
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            placeholder="Day"
            className={NUMBER_CLASS}
            value={date.value.day}
            disabled={disabled}
            aria-invalid={date.error ? true : undefined}
            onChange={(e) => date.setValue({ ...date.value, day: e.target.value })}
          />
        </div>
        {withYear ? (
          <Input
            aria-label="Birth year (optional)"
            type="number"
            inputMode="numeric"
            placeholder="Year"
            className={NUMBER_CLASS}
            value={year.value}
            disabled={disabled || !yearOn}
            aria-invalid={year.error ? true : undefined}
            onChange={(e) => year.setValue(e.target.value)}
            onBlur={year.onBlur}
            onKeyDown={year.onKeyDown}
          />
        ) : (
          <span aria-hidden="true" />
        )}
      </div>
      <ErrorLine error={date.error ?? year.error} />
      <Status saved={date.status === "saved" || year.status === "saved"} />
    </>
  );
}

/** "Remove birthday" or "Remove anniversary", behind a confirm (the repo's Dialog, as Delete uses). */
function RemoveDate({
  personId,
  personName,
  kind,
  label,
  remove,
  onRemoved,
}: {
  personId: string;
  personName: string;
  kind: Kind;
  label: string;
  remove: AboutActions["removeDate"];
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = label.toLowerCase();

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    let result: Result;
    try {
      result = await remove(personId, kind);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    onRemoved();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="link" className="self-start px-0 text-muted-foreground">
          Remove {what}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Remove {personName}&apos;s {what}?
          </DialogTitle>
          <DialogDescription>
            {kind === "birthday"
              ? "Their birth year goes too. We won't suggest gifts for it."
              : "We won't suggest gifts for it."}
          </DialogDescription>
        </DialogHeader>
        <ErrorLine error={error} />
        <div className="flex flex-col gap-2">
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void confirm()}>
            Remove {what}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
