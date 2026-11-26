"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SIZE_KINDS, type SizeKind } from "@/lib/size-kinds";
import { inputClass, labelClass } from "./ui";

// The optional card My list shows when a gift that needs a size is added and
// that size isn't saved yet (ALL-184). Saving shares it, like its switch in
// Settings > Sizes and favorites; the card says so before Save.

export type SaveSize = (kind: SizeKind, value: string) => Promise<{ ok: true } | { ok: false; error: string }>;

const DISMISSED_KEY = "giftsaf:size-ask-dismissed";

/** Kinds Not now was picked for on this device. Storage blocked or corrupt: none. */
export function dismissedSizes(): Set<SizeKind> {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function dismiss(kind: SizeKind) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedSizes(), kind]));
  } catch {
    // Storage blocked: it's asked again next time, which is harmless.
  }
}

const labelOf = (kind: SizeKind) => SIZE_KINDS.find((k) => k.kind === kind)?.label ?? kind;

type SizeAskProps = {
  kind: SizeKind;
  save: SaveSize;
  onSaved: (kind: SizeKind) => void;
  onClose: () => void;
};

export default function SizeAsk({ kind, save, onSaved, onClose }: SizeAskProps) {
  const id = useId();
  const label = labelOf(kind);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (saved) doneRef.current?.focus();
  }, [saved]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!value.trim()) {
      setError("Type a size, or pick Not now.");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await save(kind, value);
      if (result.ok) {
        setSaved(true);
        onSaved(kind);
      } else {
        setError(result.error);
        inputRef.current?.focus();
      }
    } catch {
      setError("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const sizeName = `${label.toLowerCase()} size`;

  if (saved) {
    return (
      <section aria-labelledby={`${id}-title`} className="rounded-lg bg-muted p-3 text-sm">
        <h2 id={`${id}-title`} className="sr-only">
          {`${label} size saved`}
        </h2>
        <p ref={doneRef} tabIndex={-1} role="status" className="outline-none">
          Saved. People who claim will see your {sizeName}.{" "}
          <Link href="/settings/sizes" className="font-semibold underline underline-offset-[3px]">
            Change it in Settings
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 rounded-lg bg-muted p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 id={`${id}-title`} className="text-[15px] font-semibold">
          {`Add your ${sizeName}?`}
        </h2>
        <p className="text-muted-foreground">People who claim gifts from your list will see it, so they get the right one.</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
        <label htmlFor={`${id}-value`} className={labelClass}>
          {label} size
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            id={`${id}-value`}
            type="text"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`${inputClass} max-w-48 flex-1`}
          />
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              dismiss(kind);
              onClose();
            }}
          >
            Not now
          </Button>
        </div>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
