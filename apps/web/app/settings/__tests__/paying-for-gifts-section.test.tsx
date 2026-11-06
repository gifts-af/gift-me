// @vitest-environment node
// Settings > Paying for gifts reads the session, so while Next prerenders the page its
// cookies() rejects when the prerender ends. That's Next's signal, not a failure: it must reach
// Next, not the section's "couldn't load" catch (ALL-87, CLAUDE.md > Code).
import { isHangingPromiseRejectionError, makeUntrackedHangingPromise } from "next/dist/server/dynamic-rendering-utils";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookies = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies, headers: vi.fn() }));

import { PayingForGiftsSection } from "../paying-for-gifts-section";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("PayingForGiftsSection", () => {
  it("passes Next's end-of-prerender rejection on and logs nothing", async () => {
    cookies.mockImplementation(() => makeUntrackedHangingPromise(AbortSignal.abort(), "/settings", "`cookies()`"));
    const error = await PayingForGiftsSection().then(
      () => null,
      (e: unknown) => e,
    );
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(isHangingPromiseRejectionError(error)).toBe(true);
  });

  it("handles a real failure: shows a plain line and logs an event with no error text", async () => {
    cookies.mockRejectedValue(new Error("secret detail"));
    expect(renderToStaticMarkup((await PayingForGiftsSection())!)).toContain("We couldn&#x27;t load your payment settings.");
    expect(console.log).toHaveBeenCalledOnce();
    const logged = String(vi.mocked(console.log).mock.calls[0][0]);
    expect(JSON.parse(logged)).toMatchObject({ event: "zinc.settings_load_failed", name: "Error" });
    expect(logged).not.toContain("secret detail");
  });
});
