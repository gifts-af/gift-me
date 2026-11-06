// @vitest-environment node
// While Next prerenders Home, cookies() rejects once the prerender ends. That
// isn't a failure: it must reach Next, not our "couldn't load" catch blocks,
// which would log it as an error on every prerender (ALL-87).
import { isHangingPromiseRejectionError, makeUntrackedHangingPromise } from "next/dist/server/dynamic-rendering-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookies = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies, headers: vi.fn() }));

import { HomeScreenTip } from "../home-screen-tip";
import { PeopleSection } from "../people-section";

const sections = [
  ["PeopleSection", PeopleSection],
  ["HomeScreenTip", HomeScreenTip],
] as const;

describe.each(sections)("%s during a prerender", (_name, section) => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Next's own rejection: its signal has already ended the prerender.
    cookies.mockImplementation(() => makeUntrackedHangingPromise(AbortSignal.abort(), "/", "`cookies()`"));
  });
  afterEach(() => vi.restoreAllMocks());

  it("passes Next's rejection on and logs no error", async () => {
    const error = await section().then(
      () => null,
      (e: unknown) => e,
    );
    expect(console.error).not.toHaveBeenCalled();
    expect(isHangingPromiseRejectionError(error)).toBe(true);
  });
});

describe.each(sections)("%s on a real failure", (_name, section) => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    cookies.mockRejectedValue(new Error("boom"));
  });
  afterEach(() => vi.restoreAllMocks());

  it("still handles it and logs the error", async () => {
    await section();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
