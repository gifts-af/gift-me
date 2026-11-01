import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = { header: null as string | null, profileTimezone: null as string | null, userId: "u1" as string | null };

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.header ? { "x-vercel-ip-timezone": state.header } : {}),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: state.userId ? { claims: { sub: state.userId } } : null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: state.profileTimezone }, error: null }) }) }),
    }),
  }),
}));

import { resolveToday, todayForRequest } from "@/lib/today";

// 2026-11-02 03:30 UTC: still the evening of 1 Nov in New York, already 2 Nov in Tokyo.
const NOW = new Date("2026-11-02T03:30:00Z");

describe("resolveToday", () => {
  it("uses the profile time zone first", () => {
    expect(resolveToday({ profileTimezone: "America/New_York", headerTimezone: "Asia/Tokyo", now: NOW })).toBe("2026-11-01");
    expect(resolveToday({ profileTimezone: "Asia/Tokyo", headerTimezone: "America/New_York", now: NOW })).toBe("2026-11-02");
  });

  it("falls back to the request's time zone when the profile has none", () => {
    expect(resolveToday({ profileTimezone: "", headerTimezone: "America/New_York", now: NOW })).toBe("2026-11-01");
    expect(resolveToday({ profileTimezone: null, headerTimezone: "Asia/Tokyo", now: NOW })).toBe("2026-11-02");
  });

  it("falls back to UTC, and skips zones that don't exist", () => {
    expect(resolveToday({ profileTimezone: null, headerTimezone: null, now: NOW })).toBe("2026-11-02");
    expect(resolveToday({ profileTimezone: "Nowhere/Land", headerTimezone: "America/New_York", now: NOW })).toBe("2026-11-01");
  });
});

describe("todayForRequest", () => {
  beforeEach(() => {
    state.header = null;
    state.profileTimezone = null;
    state.userId = "u1";
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("reads the profile, then the header, then UTC", async () => {
    state.profileTimezone = "America/New_York";
    state.header = "Asia/Tokyo";
    expect(await todayForRequest()).toBe("2026-11-01");
    state.profileTimezone = "";
    expect(await todayForRequest()).toBe("2026-11-02");
    state.header = null;
    expect(await todayForRequest()).toBe("2026-11-02");
  });

  it("works signed out, from the header alone", async () => {
    state.userId = null;
    state.header = "America/New_York";
    expect(await todayForRequest()).toBe("2026-11-01");
  });
});
