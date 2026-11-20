// The keys the fan-out events (ALL-125) may carry (E6, AC-17): ids, counts, flags and enums. The
// error keys are what errorFields makes: a name and short tokens, never a message. `at` is added
// by logEvent. Widening this list needs a reason in the PR; a name, email or address never goes in.
export const FANOUT_EVENT_KEYS = new Set([
  "event",
  "at",
  "enabled",
  "due",
  "sent",
  "failed",
  "count",
  "alert",
  "kind",
  "result",
  "reason",
  "round_id",
  "user_id",
  "rounds",
  "delivery_count",
  // errorFields(err)
  "name",
  "code",
  "status",
]);

/** The keys of `events` that aren't allowed, as "event.key" (empty means all clean). */
export function strayKeys(events: Record<string, unknown>[]): string[] {
  return events.flatMap((e) => Object.keys(e).filter((k) => !FANOUT_EVENT_KEYS.has(k)).map((k) => `${String(e.event)}.${k}`));
}
