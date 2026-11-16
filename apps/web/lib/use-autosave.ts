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
 *   `commit(next)` sets and saves, for choices and switches. It resolves to
 *   the last save's result once every pending save is done, or null when
 *   there was nothing to save.
 * - Saves only when the value differs from what was last saved, one save at a
 *   time; edits made during a save go in the next one.
 * - A failed save keeps the value and sets `error`, so it can be tried again.
 * - `reset(value)` makes `value` both shown and saved, with nothing pending,
 *   after something outside the hook changed it (a Remove, a Delete). A save
 *   in flight then is ignored and a queued one dropped, so a failed value can
 *   never be sent again (review of ALL-127).
 * - A pending change is also saved when the tab is hidden (switching apps).
 * - Next keeps visited routes in the page, hidden: when hidden, a pending
 *   change is saved, and if that save fails the value goes back to what's
 *   saved, so it can't look saved on return.
 * - `initial` is read once; re-key the component to start again from new props.
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
  const running = useRef<Promise<Result | null> | null>(null);
  const again = useRef(false);
  const visible = useRef(true);
  // Bumped by reset: a save started before it no longer counts.
  const round = useRef(0);
  // The latest callbacks, so the hide cleanup (from the first render) uses them.
  const saveRef = useRef(save);
  const equalsRef = useRef(equals);
  useLayoutEffect(() => {
    saveRef.current = save;
    equalsRef.current = equals;
  });

  function setValue(next: T) {
    current.current = next;
    setValueState(next);
    setStatus("idle");
    setError(null);
  }

  function reset(next: T) {
    round.current++;
    again.current = false;
    saved.current = next;
    setValue(next);
  }

  /** One save of `sending`, or null when it's already saved. */
  async function saveOnce(sending: T): Promise<Result | null> {
    if (equalsRef.current(sending, saved.current)) return null;
    const started = round.current;
    if (visible.current) setStatus("saving");
    let result: Result;
    try {
      result = await saveRef.current(sending);
    } catch {
      result = { ok: false, error: TRY_AGAIN };
    }
    if (round.current !== started) return result;
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
    return result;
  }

  function send(): Promise<Result | null> {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      let last: Result | null = null;
      let sent: T;
      do {
        again.current = false;
        sent = current.current;
        last = (await saveOnce(sent)) ?? last;
        // Asked again during the save: send only if the value changed since,
        // so a value that just failed isn't sent twice in a row.
      } while (again.current && !equalsRef.current(current.current, sent));
      again.current = false;
      running.current = null;
      return last;
    })();
    running.current = run;
    return run;
  }

  function commit(...next: [] | [T]): Promise<Result | null> {
    if (next.length) setValue(next[0]);
    return send();
  }

  useLayoutEffect(() => {
    visible.current = true;
    // Switching apps on a phone often hides the tab without a blur.
    const onTabHidden = () => {
      if (document.visibilityState === "hidden") void send();
    };
    document.addEventListener("visibilitychange", onTabHidden);
    return () => {
      document.removeEventListener("visibilitychange", onTabHidden);
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
    reset,
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
