"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { RELATIONSHIPS, relationshipLabel } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AddResult, SaveResult } from "@/modules/concierge";
import { prepareJpeg, resizeToJpeg, savePersonPhoto, type PhotoStorage } from "./photo-picker";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SELECT_CLASS =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2.5 text-base font-normal";

type Common = {
  /** Starting values (for editing). Months and days are numbers as text, "" when not given. */
  initial?: {
    id?: string;
    name?: string;
    relationship?: string;
    birthdayMonth?: string;
    birthdayDay?: string;
    birthYear?: string;
    anniversaryMonth?: string;
    anniversaryDay?: string;
  };
  submitLabel?: string;
};

type AddProps = Common & {
  mode?: "add";
  /** Saves the person: `addPersonAction`. */
  action: (previous: null, formData: FormData) => Promise<AddResult>;
  /** Saves where the photo went: `setPhotoAction`. */
  photoAction: (previous: SaveResult | null, formData: FormData) => Promise<SaveResult>;
  userId: string;
  maxUploadBytes: number;
  px: number;
  /** Where to go once saved. */
  doneHref: string;
  /** Test seams, same as PhotoPicker. */
  storage?: PhotoStorage;
  resize?: (file: File, px: number) => Promise<Blob>;
};

/** Edit mode has no photo field (the page's PhotoPicker saves photos at once) and stays on the page. */
type EditProps = Common & {
  mode: "edit";
  /** `updatePersonAction`; the person's id travels as a hidden `id` field. */
  action: (previous: null, formData: FormData) => Promise<SaveResult>;
};

type Props = AddProps | EditProps;

function DateFields({
  name,
  label,
  month,
  day,
  onMonth,
  onDay,
}: {
  name: string;
  label: string;
  month: string;
  day: string;
  onMonth: (v: string) => void;
  onDay: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_5.5rem] gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${name}-month`}>{label} month</Label>
        <select
          id={`${name}-month`}
          name={`${name}Month`}
          className={SELECT_CLASS}
          value={month}
          onChange={(e) => onMonth(e.target.value)}
        >
          <option value="">Month</option>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${name}-day`}>{label} day</Label>
        <Input
          id={`${name}-day`}
          name={`${name}Day`}
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          placeholder="Day"
          value={day}
          onChange={(e) => onDay(e.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * Name, relationship, optional photo, birthday and (for a wife or husband) an
 * anniversary. Shared by Add person and, in Task 7, Edit.
 *
 * The chosen photo stays in memory and is uploaded only after the person is
 * saved, because the storage folder needs the new person's id. If the photo
 * then fails, the person still exists, so we go on anyway.
 */
export function PersonForm(props: Props) {
  const { initial, submitLabel = "Save" } = props;
  const add = props.mode === "edit" ? null : props;
  const resize = add?.resize ?? resizeToJpeg;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [relationship, setRelationship] = useState(initial?.relationship ?? "");
  const [bMonth, setBMonth] = useState(initial?.birthdayMonth ?? "");
  const [bDay, setBDay] = useState(initial?.birthdayDay ?? "");
  const [bYear, setBYear] = useState(initial?.birthYear ?? "");
  const [aMonth, setAMonth] = useState(initial?.anniversaryMonth ?? "");
  const [aDay, setADay] = useState(initial?.anniversaryDay ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);

  // Editing always offers the anniversary, so a changed relationship keeps it.
  const showAnniversary = !add || relationship === "wife" || relationship === "husband";

  async function onPickPhoto(file: File) {
    if (!add) return;
    setPhoto(null);
    setPhotoError(null);
    setPreparing(true); // Save waits, so a tap can't drop a photo still being checked
    try {
      const checked = await prepareJpeg({
        file,
        px: add.px,
        maxUploadBytes: add.maxUploadBytes,
        resize,
      });
      if (checked.ok) setPhoto(file);
      else setPhotoError(checked.error);
    } finally {
      setPreparing(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || preparing) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    // The anniversary fields aren't rendered for other relationships, so a
    // hidden stale value is never sent.
    const form = new FormData(event.currentTarget);
    let result: AddResult | SaveResult;
    try {
      result = await props.action(null, form);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    if (!add || !("id" in result)) {
      // Edit: the page re-reads from the server; stay here.
      setSaved(true);
      setBusy(false);
      router.refresh();
      return;
    }
    // Saved. Stay busy from here on so a second tap can't add a duplicate
    // while we upload the photo and navigate.
    const newId = (result as { id: string }).id; // add mode: addPersonAction returns the new id
    let photoFailed = false;
    if (photo) {
      try {
        const saved = await savePersonPhoto({
          file: photo,
          personId: newId,
          userId: add.userId,
          px: add.px,
          maxUploadBytes: add.maxUploadBytes,
          action: add.photoAction,
          storage: add.storage,
          resize,
        });
        if (!saved.ok) {
          photoFailed = true;
          console.error("Photo not saved for new person", saved.error);
        }
      } catch (e) {
        photoFailed = true;
        console.error("Photo not saved for new person", e);
      }
    }
    // The person exists either way. A failed photo goes to their page, where
    // a note and the picker let the user try again.
    router.push(photoFailed ? `/people/${newId}?photo=failed` : add.doneHref);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-name">Name</Label>
        <Input id="person-name" name="name" autoComplete="off" defaultValue={initial?.name ?? ""} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-relationship">Who are they to you?</Label>
        <select
          id="person-relationship"
          name="relationship"
          className={SELECT_CLASS}
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
        >
          <option value="">Choose one</option>
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {relationshipLabel(r)}
            </option>
          ))}
        </select>
      </div>

      {add && (
        <div className="flex flex-col gap-1.5">
          <input
            ref={input}
            type="file"
            accept="image/*"
            aria-label="Choose a photo"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPickPhoto(file);
            }}
          />
          <Button type="button" variant="outline" onClick={() => input.current?.click()}>
            {photo ? "Change photo" : "Add a photo (optional)"}
          </Button>
          {photo && <p className="text-[13px] text-muted-foreground">{photo.name}</p>}
          {photoError && (
            <p role="alert" className="text-[13px] text-destructive">
              {photoError}
            </p>
          )}
        </div>
      )}

      <fieldset id="birthday" className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Birthday</legend>
        <DateFields name="birthday" label="Birthday" month={bMonth} day={bDay} onMonth={setBMonth} onDay={setBDay} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="birth-year">Birth year (optional)</Label>
          <Input
            id="birth-year"
            name="birthYear"
            type="number"
            inputMode="numeric"
            placeholder="Year"
            value={bYear}
            onChange={(e) => setBYear(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => {
            setBMonth("");
            setBDay("");
            setBYear("");
          }}
        >
          Skip
        </Button>
      </fieldset>

      {showAnniversary && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">{add ? "Anniversary" : "Anniversary (optional)"}</legend>
          <DateFields
            name="anniversary"
            label="Anniversary"
            month={aMonth}
            day={aDay}
            onMonth={setAMonth}
            onDay={setADay}
          />
        </fieldset>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}

      {saved && (
        <p role="status" className="text-[13px] text-muted-foreground">
          Saved
        </p>
      )}

      <Button type="submit" disabled={busy || preparing} aria-busy={busy || preparing}>
        {busy ? "Saving…" : preparing ? "Preparing photo…" : submitLabel}
      </Button>
    </form>
  );
}
