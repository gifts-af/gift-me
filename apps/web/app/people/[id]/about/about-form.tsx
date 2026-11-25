"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent } from "react";
import { RELATIONSHIPS, relationshipLabel, toDate } from "@gifts-af/core";
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

type Result = { ok: true; note?: string } | { ok: false; error: string };
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
/** The longest name the rules accept (people/rules.ts). */
const MAX_NAME_LENGTH = 120;
// A leap year, so 29 February is a real birthday (as people/rules.ts checks).
const LEAP_YEAR = 2000;
/**
 * UI timing, like ALL-115's picker wait: how long the date waits after a blur
 * that goes nowhere before saving. On an iPhone, closing the month wheel or
 * tapping between month and day blurs with no target; waiting lets the day
 * be picked before anything is saved (review of ALL-127).
 */
export const DATE_SETTLE_MS = 1500;

type DateText = { month: string; day: string };
const EMPTY_DATE: DateText = { month: "", day: "" };
const sameDate = (a: DateText, b: DateText) => a.month === b.month && a.day === b.day;
const dateText = (d: MonthDay | null): DateText => (d ? { month: String(d.month), day: String(d.day) } : EMPTY_DATE);

/** True for a whole month and day that happen in some year. The server checks again. */
function isRealDate(d: DateText): boolean {
  if (!/^\d{1,2}$/.test(d.month) || !/^\d{1,2}$/.test(d.day)) return false;
  try {
    toDate(LEAP_YEAR, Number(d.month), Number(d.day));
    return true;
  } catch {
    return false;
  }
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
        maxLength={MAX_NAME_LENGTH}
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
 * A birthday (with its year) or an anniversary. Month and day are one value,
 * saved together when focus leaves them, so a date passed through on the way
 * to another is never saved (AC-5). Only a real date is sent; cleared or
 * impossible ones never are (AC-6).
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
  // A date is saved: offers Remove and turns the year on.
  const [hasDate, setHasDate] = useState(saved !== null);
  // What the last save said about the date: a gift that keeps its old one, or that it's too late.
  const [note, setNote] = useState<string | null>(null);
  const onPage = useRef(true);
  useLayoutEffect(() => {
    onPage.current = true;
    // Next keeps visited pages, hidden: a note from before would be out of date on return.
    return () => {
      onPage.current = false;
      setNote(null);
    };
  }, []);
  const date = useAutosave<DateText>({
    initial: dateText(saved),
    equals: sameDate,
    save: async (value) => {
      if (!isRealDate(value)) return { ok: false, error: BAD_DATE };
      const result = await actions.setDate(personId, kind, value.month, value.day);
      if (result.ok) {
        setHasDate(true);
        // Not for a date that's been edited again since.
        if (onPage.current && sameDate(shown.current, value)) setNote(result.note ?? null);
      }
      return result;
    },
  });
  const year = useAutosave({
    initial: birthYear === null ? "" : String(birthYear),
    save: (value) => actions.setBirthYear(personId, value),
  });
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The fields as last shown, for a save the timer runs later (an iPhone can
  // fire the picker's change after its blur).
  const shown = useRef(date.value);
  useLayoutEffect(() => {
    shown.current = date.value;
  });

  function editDate(next: DateText) {
    setNote(null);
    date.setValue(next);
  }
  function cancelSettle() {
    if (settle.current) clearTimeout(settle.current);
    settle.current = null;
  }
  // Leaving the page saves through the hook; the timer just goes.
  useEffect(() => cancelSettle, []);

  function saveDate() {
    cancelSettle();
    // Cleared or half-filled: nothing to save. "Remove birthday" removes one.
    if (shown.current.month === "" || shown.current.day === "") return;
    void date.commit();
  }

  function leaveDate(event: FocusEvent<HTMLDivElement>) {
    const to = event.relatedTarget as Node | null;
    if (to && event.currentTarget.contains(to)) return;
    // Focus went nowhere (an iPhone picker closing): wait, in case it comes back.
    if (!to) {
      cancelSettle();
      settle.current = setTimeout(saveDate, DATE_SETTLE_MS);
      return;
    }
    saveDate();
  }

  return (
    <fieldset className="flex flex-col gap-2">
      {/* The legend must be the fieldset's first child to name the group. */}
      <legend className="mb-1.5 p-0 text-[15px] font-semibold">{label}</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.75rem] gap-2">
        <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2" onBlur={leaveDate} onFocus={cancelSettle}>
          <NativeSelect
            aria-label={`${label} month`}
            value={date.value.month}
            disabled={disabled}
            aria-invalid={date.error ? true : undefined}
            onChange={(e) => editDate({ ...date.value, month: e.target.value })}
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
            onChange={(e) => editDate({ ...date.value, day: e.target.value })}
          />
        </div>
        {kind === "birthday" ? (
          <Input
            aria-label="Birth year (optional)"
            type="number"
            inputMode="numeric"
            placeholder="Year"
            className={NUMBER_CLASS}
            value={year.value}
            disabled={disabled || !hasDate}
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
      {/* Always mounted, so a screen reader announces the text when it comes. */}
      <p aria-live="polite" className="text-[13px] text-foreground">
        {note}
      </p>
      {kind === "birthday" && (
        <p className="text-[13px] text-muted-foreground">
          The year is just for age-right ideas.
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
            // Removed on the server: empty and saved, with nothing pending, so
            // a date that failed to save is never sent again (review blocker).
            cancelSettle();
            date.reset(EMPTY_DATE);
            year.reset("");
            setNote(null);
            setHasDate(false);
          }}
        />
      )}
    </fieldset>
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
              ? "Their birth year goes too. It won't be used for gift ideas."
              : "It won't be used for gift ideas."}
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
