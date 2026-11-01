// @vitest-environment node
import { describe, expect, it } from "vitest";
import { installPlatform, isRunningInstalled, isSnoozed } from "@/lib/install-tip";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1";
// iPadOS asks for desktop sites, so it looks like a Mac apart from its touch screen.
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("installPlatform", () => {
  it.each([
    ["iPhone Safari", IPHONE, 5, "ios"],
    ["iPhone Chrome", IPHONE_CHROME, 5, "ios"],
    ["iPad (desktop mode)", IPAD_AS_MAC, 5, "ios"],
    ["Android Chrome", ANDROID, 5, "android"],
    ["a Mac", IPAD_AS_MAC, 0, null],
    ["Windows", WINDOWS, 0, null],
  ] as const)("%s → %s", (_name, ua, touchPoints, expected) => {
    expect(installPlatform(ua, touchPoints)).toBe(expected);
  });
});

describe("isRunningInstalled", () => {
  const env = (standalone: boolean, iosStandalone?: boolean) => ({
    matchMedia: (query: string) => ({ matches: standalone && query === "(display-mode: standalone)" }),
    navigator: { standalone: iosStandalone },
  });

  it("is true when opened from the Home Screen (display-mode: standalone)", () => {
    expect(isRunningInstalled(env(true))).toBe(true);
  });

  it("is true for an iPhone Home Screen app (navigator.standalone)", () => {
    expect(isRunningInstalled(env(false, true))).toBe(true);
  });

  it("is false in a browser tab", () => {
    expect(isRunningInstalled(env(false, false))).toBe(false);
  });
});

describe("isSnoozed", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("is not snoozed if never dismissed", () => {
    expect(isSnoozed(null, now, 14)).toBe(false);
  });

  it("stays snoozed until the snooze length has passed", () => {
    expect(isSnoozed("2026-11-02T12:00:01Z", now, 14)).toBe(true);
  });

  it("comes back once the snooze length has passed", () => {
    expect(isSnoozed("2026-11-01T12:00:00Z", now, 14)).toBe(false);
  });

  it("treats a garbled stored value as not dismissed", () => {
    expect(isSnoozed("not a date", now, 14)).toBe(false);
  });
});
