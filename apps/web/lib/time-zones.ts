// Time zones come from the server, never from the browser during render: the two
// can disagree, which is a hydration error on Safari (ALL-102).

/** True when the runtime knows this zone. Accepts aliases the list doesn't show, like Asia/Calcutta. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The server's zones, with `saved` first when the list doesn't include it. */
export function timeZoneOptions(saved: string | null): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return saved && !all.includes(saved) ? [saved, ...all] : all;
}
