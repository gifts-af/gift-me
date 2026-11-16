"use client";

import { ChevronRight } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import type { SaveResult } from "@/modules/concierge";

const TRY_AGAIN = "That didn't save. Try again.";
// How long a pick waits for another one before it's sent.
const PICK_DELAY_MS = 400;

const pretty = (zone: string) => zone.replace(/_/g, " ");

/**
 * The Time zone row in Settings (ALL-115). A transparent native select covers the
 * row, so a tap opens the browser's own picker, and a pick saves by itself.
 * Zones come from the server: nothing here reads Intl (ALL-102).
 */
export function TimeZoneRow({
  zones,
  saved,
  fallback,
  action,
}: {
  zones: string[];
  saved: string | null;
  fallback: string | null;
  action: (zone: string) => Promise<SaveResult>;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const [picked, setPicked] = useState(saved);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(0);

  // Next keeps visited routes in the page, hidden, with their state: clear the
  // tick and error on leaving. A pick still waiting is left to send.
  const visible = useRef(true);
  useLayoutEffect(() => {
    visible.current = true;
    return () => {
      visible.current = false;
      setDone(false);
      setError(null);
    };
  }, []);

  async function send(zone: string, attempt: number) {
    let result: SaveResult;
    try {
      result = await action(zone);
    } catch {
      result = { ok: false, error: TRY_AGAIN };
    }
    if (attempt !== latest.current) return;
    if (!visible.current) {
      // Hidden while saving: show nothing on return, but a failed pick goes back to what's saved.
      if (!result.ok) setPicked(saved);
      return;
    }
    if (result.ok) setDone(true);
    else setError(result.error);
  }

  function pick(zone: string) {
    const attempt = ++latest.current;
    setPicked(zone);
    setDone(false);
    setError(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(zone, attempt), PICK_DELAY_MS);
  }

  const value = picked ? pretty(picked) : fallback ? `Not set (using ${pretty(fallback)})` : "Not set";

  return (
    <div>
      <div
        aria-disabled={!hydrated}
        className="relative flex min-h-11 items-center justify-between gap-3 aria-disabled:opacity-45"
      >
        <span id={`${id}-label`} className="text-[15px]">
          Time zone
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <span id={`${id}-value`} className="truncate text-[15px] text-muted-foreground">
            {value}
          </span>
          <ChevronRight className="size-5 flex-none text-muted-foreground" aria-hidden="true" />
        </span>
        <select
          aria-labelledby={`${id}-label ${id}-value`}
          disabled={!hydrated}
          value={picked ?? ""}
          onChange={(event) => pick(event.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        >
          {!picked && <option value="" disabled hidden />}
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {pretty(zone)}
            </option>
          ))}
        </select>
      </div>
      <p role="status" className="text-[13px] text-success">
        {done ? "Saved" : ""}
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
