"use client";

import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RELATIONSHIPS, relationshipLabel } from "@gifts-af/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PersonAvatar } from "@/components/person-avatar";
import { useHydrated } from "@/lib/use-hydrated";
import type { AddResult, SaveResult } from "@/modules/concierge";
import { prepareJpeg, resizeToJpeg, savePersonPhoto, type PhotoStorage } from "./photo-picker";

export const MONTH_NAMES = [
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

// Number boxes without the browser's up and down arrows, which crowd a short box.
export const NUMBER_CLASS =
  "px-2.5 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

// One look for every section of the form (ALL-109), and of About (ALL-127).
export const CARD_CLASS = "flex flex-col gap-4 rounded-xl border border-border p-4";

type Props = {
  /** Saves the person: `addPersonAction`. */
  action: (previous: null, formData: FormData) => Promise<AddResult>;
  /** Saves where the photo went: `setPhotoAction`. */
  photoAction: (previous: SaveResult | null, formData: FormData) => Promise<SaveResult>;
  userId: string;
  maxUploadBytes: number;
  px: number;
  /** Where to go once saved. Added from a list link, the new person's page instead. */
  doneHref: string;
  /** The list owner's name, from a list link (ALL-123). */
  initialName?: string;
  /** A shared list's token (ALL-123): sent as `list`, so the save also links that list. */
  shareToken?: string;
  /** To the concierge: without it no gift is waiting to ship. */
  hasAccess?: boolean;
  /** Test seams, same as PhotoPicker. */
  storage?: PhotoStorage;
  resize?: (file: File, px: number) => Promise<Blob>;
};

/** Month, day and (birthday only) year on one row. Labels are for screen readers. */
function DateFields({
  name,
  label,
  month,
  day,
  year,
  onMonth,
  onDay,
  onYear,
}: {
  name: string;
  label: string;
  month: string;
  day: string;
  /** Present only for the birthday; the anniversary row leaves the year cell empty. */
  year?: string;
  onMonth: (v: string) => void;
  onDay: (v: string) => void;
  onYear?: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_5.75rem] gap-2">
      <NativeSelect
        aria-label={`${label} month`}
        name={`${name}Month`}
        value={month}
        onChange={(e) => onMonth(e.target.value)}
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
        name={`${name}Day`}
        type="number"
        inputMode="numeric"
        min={1}
        max={31}
        placeholder="Day"
        className={NUMBER_CLASS}
        value={day}
        onChange={(e) => onDay(e.target.value)}
      />
      {onYear ? (
        <Input
          aria-label="Birth year (optional)"
          name="birthYear"
          type="number"
          inputMode="numeric"
          placeholder="Year"
          className={NUMBER_CLASS}
          value={year ?? ""}
          onChange={(e) => onYear(e.target.value)}
        />
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * Name, relationship, optional photo, birthday and (for a wife or husband) an
 * anniversary: Add person. Changing someone later happens on About, which
 * saves each field as you go (ALL-127).
 *
 * The chosen photo stays in memory and is uploaded only after the person is
 * saved, because the storage folder needs the new person's id. If the photo
 * then fails, the person still exists, so we go on anyway.
 */
export function PersonForm(props: Props) {
  const resize = props.resize ?? resizeToJpeg;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const hydrated = useHydrated();
  const [name, setName] = useState(props.initialName ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [relationship, setRelationship] = useState("");
  const [bMonth, setBMonth] = useState("");
  const [bDay, setBDay] = useState("");
  const [bYear, setBYear] = useState("");
  const [aMonth, setAMonth] = useState("");
  const [aDay, setADay] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);

  // The photo preview is an object URL; revoke it when the photo changes or the form goes away.
  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const trimmed = name.trim();
  const submitLabel = trimmed ? `Add ${trimmed}` : "Add someone";
  const showAnniversary = relationship === "wife" || relationship === "husband";

  async function onPickPhoto(file: File) {
    setPhoto(null);
    setPhotoError(null);
    setPreparing(true); // Save waits, so a tap can't drop a photo still being checked
    try {
      const checked = await prepareJpeg({
        file,
        px: props.px,
        maxUploadBytes: props.maxUploadBytes,
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
    setBusy(true);
    // The anniversary fields aren't rendered for other relationships, so a
    // hidden stale value is never sent.
    const form = new FormData(event.currentTarget);
    let result: AddResult;
    try {
      result = await props.action(null, form);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    if (!result.ok) {
      setError(result.error);
      // Already added from this list (ALL-123): open them, and stay busy so
      // a second tap can't try again on the way.
      if (result.existingId) {
        router.push(`/people/${result.existingId}`);
        return;
      }
      setBusy(false);
      return;
    }
    // Saved. Stay busy from here on so a second tap can't add a duplicate
    // while we upload the photo and navigate.
    const newId = result.id;
    let photoFailed = false;
    if (photo) {
      try {
        const saved = await savePersonPhoto({
          file: photo,
          personId: newId,
          userId: props.userId,
          px: props.px,
          maxUploadBytes: props.maxUploadBytes,
          action: props.photoAction,
          storage: props.storage,
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
    // Added from a list link, the new person's page shows the link (ALL-123).
    router.push(photoFailed ? `/people/${newId}?photo=failed` : props.shareToken ? `/people/${newId}` : props.doneHref);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {props.shareToken && (
        <>
          <input type="hidden" name="list" value={props.shareToken} />
          {props.hasAccess && (
            <p className="rounded-xl bg-muted px-4 py-3 text-[13px] text-muted-foreground">
              If a gift for them is waiting on an address, it will ship to this list&apos;s owner.
            </p>
          )}
        </>
      )}
      <section aria-label="Who they are" className={CARD_CLASS}>
        <div className="flex flex-col items-center gap-1">
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
          <button
            type="button"
            aria-label={photo ? "Change photo" : "Add a photo"}
            onClick={() => input.current?.click()}
            aria-disabled={hydrated ? undefined : true}
            className="flex min-h-11 flex-col items-center gap-1.5 rounded-md text-[14px] font-semibold text-primary aria-disabled:opacity-45"
          >
            <span className="relative inline-flex">
              <PersonAvatar name={trimmed} photoUrl={previewUrl} size={88} decorative />
              <span className="absolute -right-0.5 -bottom-0.5 flex size-[30px] items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                <Camera className="size-4" aria-hidden="true" />
              </span>
            </span>
            <span aria-hidden="true">{photo ? "Change photo" : "Add photo"}</span>
          </button>
          {photoError && (
            <p role="alert" className="text-center text-[13px] text-destructive">
              {photoError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="person-name">Name</Label>
          <Input
            id="person-name"
            name="name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="person-relationship">Who are they to you?</Label>
          <NativeSelect
            id="person-relationship"
            name="relationship"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
          >
            <option value="">Choose one</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {relationshipLabel(r)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </section>

      <section aria-labelledby="dates-heading" className={CARD_CLASS}>
        <div className="flex items-baseline justify-between">
          <h2 id="dates-heading" className="text-base font-semibold">
            Dates
          </h2>
          <span className="text-[13px] text-muted-foreground">Optional</span>
        </div>

        <fieldset className="flex flex-col gap-2">
          {/* The legend must be the fieldset's first child to name the group. */}
          <legend className="mb-1.5 p-0 text-[15px] font-semibold">Birthday</legend>
          <DateFields
            name="birthday"
            label="Birthday"
            month={bMonth}
            day={bDay}
            year={bYear}
            onMonth={setBMonth}
            onDay={setBDay}
            onYear={setBYear}
          />
          <p className="text-[13px] text-muted-foreground">
            The year is just for age-right ideas.
          </p>
        </fieldset>

        {showAnniversary && (
          // A divider above, on a wrapper: a fieldset's own border runs through its legend.
          <div className="border-t border-border pt-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 p-0 text-[15px] font-semibold">Anniversary</legend>
              <DateFields
                name="anniversary"
                label="Anniversary"
                month={aMonth}
                day={aDay}
                onMonth={setAMonth}
                onDay={setADay}
              />
            </fieldset>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={busy || preparing} aria-busy={busy || preparing}>
        <span className="truncate">{busy ? "Saving…" : preparing ? "Preparing photo…" : submitLabel}</span>
      </Button>
    </form>
  );
}
