"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { guessRelationship, RELATIONSHIPS, relationshipLabel, type GoogleContact } from "@gifts-af/core";
import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHydrated } from "@/lib/use-hydrated";
import type { ImportResult } from "@/modules/concierge";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SELECT_CLASS =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base font-normal sm:w-48";

type Stage = { kind: "start" } | { kind: "loading" } | { kind: "failed" } | { kind: "list"; contacts: GoogleContact[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const checkboxId = (c: GoogleContact) => `contact-${c.googleId.replace(/\W/g, "-")}`;
const pickerId = (c: GoogleContact) => `${checkboxId(c)}-who`;

// The "Who do you buy gifts for?" checklist (ALL-24). Contacts come from
// `load` (Google's popup and People API, in the browser); only the ticked ones
// are sent to the server action, as JSON in `rows`.
export function ImportChecklist({
  action,
  imported,
  load,
  onAgain,
}: {
  action: (previous: ImportResult | null, formData: FormData) => Promise<ImportResult>;
  /** Google contact ids already imported: shown as "Already added". */
  imported: string[];
  load: () => Promise<GoogleContact[]>;
  /** Starts the checklist over after an import (ALL-72). */
  onAgain?: () => void;
}) {
  const hydrated = useHydrated();
  const [stage, setStage] = useState<Stage>({ kind: "start" });
  const [search, setSearch] = useState("");
  // Ticked contacts and the relationship picked for each ("" until picked).
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [onlyTicked, setOnlyTicked] = useState(false);
  // A picker to scroll to and focus once it's rendered (ALL-72).
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(focusId);
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el?.focus();
    setFocusId(null);
  }, [focusId]);
  const [result, submit, saving] = useActionState(action, null);
  const done = useMemo(() => new Set(imported), [imported]);

  async function connect() {
    setStage({ kind: "loading" });
    try {
      setStage({ kind: "list", contacts: await load() });
    } catch (e) {
      console.error("loading Google contacts failed", e);
      setStage({ kind: "failed" });
    }
  }

  if (result?.ok) return <Finished result={result} onAgain={onAgain} />;

  if (stage.kind !== "list") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px] text-muted-foreground">
          Google will ask to let GiftsAF see your contacts, just this once. You pick who to add; we keep only the
          people you tick, and never your Google sign-in.
        </p>
        {stage.kind === "failed" && (
          <p role="alert" className="text-[14px] text-destructive">
            We couldn&apos;t get your contacts from Google. Try again, and allow access when Google asks.
          </p>
        )}
        <Button className="self-start" onClick={connect} disabled={!hydrated || stage.kind === "loading"}>
          {stage.kind === "loading" ? "Getting your contacts…" : "Connect Google Contacts"}
        </Button>
      </div>
    );
  }

  const contacts = stage.contacts;
  if (contacts.length === 0) {
    return <p className="text-[15px] text-muted-foreground">Google didn&apos;t send any contacts with names.</p>;
  }

  const query = search.trim().toLowerCase();
  const ticked = contacts.filter((c) => picked.has(c.googleId));
  const showOnlyTicked = onlyTicked && ticked.length > 0;
  const shown = contacts.filter(
    (c) => (!query || c.name.toLowerCase().includes(query)) && (!showOnlyTicked || picked.has(c.googleId)),
  );
  // Ticked but no relationship yet: the reason Add is off (ALL-72).
  const missing = ticked.filter((c) => !picked.get(c.googleId));
  const ready = ticked.length > 0 && missing.length === 0;

  function goToMissing() {
    const first = missing[0];
    if (!shown.includes(first)) setSearch("");
    setFocusId(pickerId(first));
  }

  function toggle(c: GoogleContact) {
    const next = new Map(picked);
    if (next.has(c.googleId)) next.delete(c.googleId);
    else next.set(c.googleId, guessRelationship(c.name, c.nickname) ?? "");
    setPicked(next);
  }

  function choose(c: GoogleContact, relationship: string) {
    setPicked(new Map(picked).set(c.googleId, relationship));
  }

  const rows = ticked.map((c) => ({
    googleId: c.googleId,
    name: c.name,
    relationship: picked.get(c.googleId),
    birthday: c.birthday,
    address: c.address && { firstName: c.firstName, lastName: c.lastName, ...c.address },
    photoUrl: c.photoUrl,
  }));

  return (
    <form action={submit} className="flex flex-col gap-4">
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <Input
        type="search"
        aria-label="Search your contacts"
        placeholder="Search your contacts"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <label className="flex min-h-11 items-center gap-2 self-start text-[14px] font-semibold">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={showOnlyTicked}
          disabled={ticked.length === 0}
          onChange={(e) => setOnlyTicked(e.target.checked)}
        />
        Show ticked ({ticked.length})
      </label>
      <ul className="flex flex-col divide-y rounded-lg border">
        {shown.map((c) => {
          const already = done.has(c.googleId);
          const on = picked.has(c.googleId);
          const relationship = picked.get(c.googleId) ?? "";
          const id = checkboxId(c);
          return (
            <li key={c.googleId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <label htmlFor={id} className="flex min-h-11 flex-1 items-center gap-3">
                <input
                  id={id}
                  type="checkbox"
                  aria-label={c.name}
                  className="size-5 accent-primary"
                  checked={on}
                  disabled={already}
                  onChange={() => toggle(c)}
                />
                <PersonAvatar name={c.name} photoUrl={c.photoUrl} size={40} decorative />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[15px] font-semibold">{c.name}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {already
                      ? "Already added"
                      : [
                          c.birthday && `Birthday ${MONTHS[c.birthday.month - 1]} ${c.birthday.day}`,
                          c.address && "Has an address",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </span>
                </span>
              </label>
              {on && (
                <div className="flex flex-col gap-1 pl-8 sm:pl-0">
                  <select
                    id={pickerId(c)}
                    aria-label={`Who is ${c.name} to you?`}
                    className={SELECT_CLASS}
                    value={relationship}
                    onChange={(e) => choose(c, e.target.value)}
                  >
                    <option value="">Who are they?</option>
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {relationshipLabel(r)}
                      </option>
                    ))}
                  </select>
                  {!relationship && <span className="text-[13px] text-warning">Pick who they are</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {result && !result.ok && (
        <p role="alert" className="text-[14px] text-destructive">
          {result.error}
        </p>
      )}
      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <Button type="submit" className="w-full sm:w-auto" disabled={!ready || saving} aria-busy={saving}>
            {saving
              ? "Adding…"
              : ticked.length === 0
                ? "Add people"
                : `Add ${plural(ticked.length, "person", "people")}`}
          </Button>
          {missing.length > 0 && (
            <button
              type="button"
              onClick={goToMissing}
              className="min-h-11 text-left text-[14px] font-semibold text-warning underline underline-offset-[3px]"
            >
              {missing.length === 1
                ? `Pick who ${missing[0].name} is to you`
                : `Pick who ${missing.length} people are to you`}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function Finished({ result, onAgain }: { result: Extract<ImportResult, { ok: true }>; onAgain?: () => void }) {
  const notes = [
    result.skipped > 0 && `${plural(result.skipped, "was", "were")} already added`,
    result.failed > 0 && `${plural(result.failed, "couldn't", "couldn't")} be added; try them again`,
    result.photosMissed > 0 && `${plural(result.photosMissed, "photo", "photos")} couldn't be copied`,
  ].filter(Boolean);
  return (
    <div role="status" className="flex flex-col gap-3 rounded-2xl bg-accent p-5 text-accent-foreground">
      <p className="text-[18px] font-bold">Added {plural(result.added, "person", "people")}.</p>
      {notes.length > 0 && <p className="text-[15px]">{notes.join(". ")}.</p>}
      <p className="text-[15px]">Their birthdays and holidays are set up. Check each one&apos;s page to fine-tune.</p>
      <Link href="/" className="self-start font-semibold underline underline-offset-[3px]">
        See them on Give
      </Link>
      {onAgain && (
        <Button variant="outline" className="self-start" onClick={onAgain}>
          Import more people
        </Button>
      )}
    </div>
  );
}
