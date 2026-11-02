// Rules for the "Add GiftsAF to your Home Screen" tip (ALL-57). Kept free of
// React so they're easy to test.

export type InstallPlatform = "ios" | "android";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Which phone install steps to show, or null on a computer (never shown). */
export function installPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform | null {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  // iPadOS asks for desktop sites, so an iPad looks like a Mac with a touch screen.
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return null;
}

type DisplayEnv = {
  matchMedia: (query: string) => { matches: boolean };
  navigator: { standalone?: boolean };
};

/** True when GiftsAF was opened from its Home Screen icon. */
export function isRunningInstalled(env: DisplayEnv): boolean {
  return env.matchMedia("(display-mode: standalone)").matches || env.navigator.standalone === true;
}

/** True while a "Not now" from `dismissedAt` (an ISO date) is still in effect. */
export function isSnoozed(dismissedAt: string | null, now: Date, snoozeDays: number): boolean {
  if (!dismissedAt) return false;
  const at = Date.parse(dismissedAt);
  if (Number.isNaN(at)) return false;
  return now.getTime() - at < snoozeDays * DAY_MS;
}
