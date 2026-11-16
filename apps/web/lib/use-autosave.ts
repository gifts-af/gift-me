"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

/** What a save returns; matches the concierge's `SaveResult`. */
type Result = { ok: true } | { ok: false; error: string };

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

const TRY_AGAIN = "That didn't save. Try again.";

/**
 * Save as you go (T71), extracted from ALL-115's over-budget field.
 *
 * - `commit()` saves the current value now (blur and Enter call it);
 *   `commit(next)` sets and saves, for choices and switches.
 * - Saves only when the value differs from what was last saved, one save at a
 *   time; edits made during a save go in the next one.
 * - A failed save keeps the value and sets `error`, so it can be tried again.
 * - Next keeps visited routes in the page, hidden: when hidden, a pending
 *   change is saved, and if that save fails the value goes back to what's
 *   saved, so it can't look saved on return.
 * - `initial` is read once; re-key the component to reset it.
 */
export function useAutosave<T>({
  initial,
  save,
  equals = Object.is,
}: {
  initial: T;
  save: (value: T) => Promise<Result>;
  equals?: (a: T, b: T) => boolean;
}) {
  const [value, setValueState] = useState<T>(initial);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const current = useRef(initial);
  const saved = useRef(initial);
  const busy = useRef(false);
  const again = useRef(false);
  const visible = useRef(true);
  // The latest callbacks, so the hide cleanup (from the first render) uses them.
  const saveRef = useRef(save);
  const equalsRef = useRef(equals);
  saveRef.current = save;
  equalsRef.current = equals;

  function setValue(next: T) {
    current.current = next;
    setValueState(next);
    setStatus("idle");
    setError(null);
  }

  async function send(): Promise<void> {
    if (busy.current) {
      again.current = true;
      return;
    }
    const sending = current.current;
    if (equalsRef.current(sending, saved.current)) return;
    busy.current = true;
    if (visible.current) setStatus("saving");
    let result: Result;
    try {
      result = await saveRef.current(sending);
    } catch {
      result = { ok: false, error: TRY_AGAIN };
    }
    busy.current = false;
    if (result.ok) saved.current = sending;
    if (!visible.current) {
      if (!result.ok) {
        current.current = saved.current;
        setValueState(saved.current);
      }
    } else if (result.ok) {
      setError(null);
      setStatus(equalsRef.current(current.current, sending) ? "saved" : "idle");
    } else {
      setError(result.error);
      setStatus("error");
    }
    if (again.current) {
      again.current = false;
      await send();
    }
  }

  function commit(...next: [] | [T]) {
    if (next.length) setValue(next[0]);
    return send();
  }

  useLayoutEffect(() => {
    visible.current = true;
    return () => {
      visible.current = false;
      void send();
      setStatus("idle");
      setError(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    value,
    setValue,
    commit,
    onBlur: () => void send(),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void send();
    },
    status,
    error,
  };
}
