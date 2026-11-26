"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SIZE_KINDS, type SizeKind } from "@/lib/size-kinds";
import { inputClass, labelClass } from "./ui";

// The optional card My list shows when a gift that needs a size is added and
// that size isn't saved yet (T100). Saving shares it, like its switch in
// Settings > Sizes and favorites; the card and its button say so before Save.

export type SaveSize = (
  kind: SizeKind,
  value: string,
) => Promise<{ ok: true } | { ok: false; error: string }>;

// Per account, so one person's Not now on a shared device doesn't silence the next.
const dismissedKey = (userId: string) => `giftsaf:size-ask-dismissed:${userId}`;

/** Kinds Not now was picked for, for this account on this device. Storage blocked or corrupt: none. */
export function dismissedSizes(userId: string): Set<SizeKind> {
  try {
    const raw = JSON.parse(localStorage.getItem(dismissedKey(userId)) ?? "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function dismiss(userId: string, kind: SizeKind) {
  try {
    localStorage.setItem(
      dismissedKey(userId),
      JSON.stringify([...dismissedSizes(userId), kind]),
    );
  } catch {
    // Storage blocked: it's asked again next time, which is harmless.
  }
}

export const sizeName = (kind: SizeKind) =>
  `${(SIZE_KINDS.find((k) => k.kind === kind)?.label ?? kind).toLowerCase()} size`;

type SizeAskProps = {
  kind: SizeKind;
  userId: string;
  save: SaveSize;
  /** Called as Save is pressed, so a second gift added meanwhile doesn't ask again. */
  onSaving: (kind: SizeKind) => void;
  /** The save didn't happen: the kind can be asked for again. */
  onFailed: (kind: SizeKind) => void;
  onClose: () => void;
};

export default function SizeAsk({
  kind,
  userId,
  save,
  onSaving,
  onFailed,
  onClose,
}: SizeAskProps) {
  const id = useId();
  const label = SIZE_KINDS.find((k) => k.kind === kind)?.label ?? kind;
  const name = sizeName(kind);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // A ref, not state: two quick presses would both read state as not busy.
  const busy = useRef(false);
  const [busyShown, setBusyShown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (saved) doneRef.current?.focus();
  }, [saved]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (!value.trim()) {
      setError("Type a size, or pick Not now.");
      inputRef.current?.focus();
      return;
    }
    busy.current = true;
    setBusyShown(true);
    setError(null);
    onSaving(kind);
    let result: Awaited<ReturnType<SaveSize>>;
    try {
      result = await save(kind, value);
    } catch {
      result = { ok: false, error: "That didn't save. Try again." };
    }
    busy.current = false;
    setBusyShown(false);
    if (result.ok) {
      setSaved(true);
    } else {
      onFailed(kind);
      setError(result.error);
      inputRef.current?.focus();
    }
  }

  if (saved) {
    return (
      <section
        aria-labelledby={`${id}-title`}
        className="rounded-lg bg-muted p-3 text-sm"
      >
        <h2 id={`${id}-title`} className="sr-only">
          {`${label} size saved`}
        </h2>
        <p ref={doneRef} tabIndex={-1} role="status" className="outline-none">
          Saved and shared. Anyone with your list link will see your {name} when
          they go to claim.{" "}
          <Link
            href="/settings/sizes"
            className="font-semibold underline underline-offset-[3px]"
          >
            Change it in Settings
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-lg bg-muted p-3 text-sm"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id={`${id}-title`} className="text-[15px] font-semibold">
          {`Add your ${name}?`}
        </h2>
        <p className="text-muted-foreground">
          Optional. Anyone with your list link will see it when they go to
          claim, so they get the right one.
        </p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
        <label htmlFor={`${id}-value`} className={labelClass}>
          {label} size
        </label>
        <input
          ref={inputRef}
          id={`${id}-value`}
          type="text"
          autoComplete="off"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${inputClass} max-w-60`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busyShown}>
            Save and share
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              dismiss(userId, kind);
              onClose();
            }}
          >
            Not now
          </Button>
        </div>
        {error && (
          <p
            id={`${id}-error`}
            role="alert"
            className="text-[13px] text-destructive"
          >
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
