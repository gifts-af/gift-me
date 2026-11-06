// @vitest-environment node
// While Next prerenders a page, cookies() rejects once the prerender ends. That
// isn't a failure: it must reach Next, not our "couldn't load" catch blocks,
// which would log it as an error on every prerender (ALL-87).
//
// next/dist is private on purpose here: this needs Next's real rejection, not a
// copy of it, so a Next upgrade that changes it should break this test loudly.
import { isHangingPromiseRejectionError, makeUntrackedHangingPromise } from "next/dist/server/dynamic-rendering-utils";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookies = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies, headers: vi.fn() }));

import { ImportSection } from "@/app/people/import/import-section";
import { HomeScreenTip } from "../home-screen-tip";
import { PeopleSection } from "../people-section";

const COULD_NOT_LOAD = /We couldn&#x27;t load your people\. Refresh to try again\./;
const NOTHING = /^$/;

const sections = [
  { name: "PeopleSection", section: PeopleSection, event: "people_load_failed", shows: COULD_NOT_LOAD },
  { name: "HomeScreenTip", section: HomeScreenTip, event: "install_tip_failed", shows: NOTHING },
  { name: "ImportSection", section: ImportSection, event: "imported_contacts_load_failed", shows: COULD_NOT_LOAD },
];

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(sections)("$name", ({ section, event, shows }) => {
  it("passes Next's end-of-prerender rejection on and logs nothing", async () => {
    // Next's own rejection: its signal has already ended the prerender.
    cookies.mockImplementation(() => makeUntrackedHangingPromise(AbortSignal.abort(), "/", "`cookies()`"));
    const error = await section().then(
      () => null,
      (e: unknown) => e,
    );
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(isHangingPromiseRejectionError(error)).toBe(true);
  });

  it("handles a real failure: shows its fallback and logs an event with no error text", async () => {
    cookies.mockRejectedValue(new Error("secret detail"));
    expect(renderToStaticMarkup(await section())).toMatch(shows);
    expect(console.log).toHaveBeenCalledOnce();
    const logged = String(vi.mocked(console.log).mock.calls[0][0]);
    expect(JSON.parse(logged)).toMatchObject({ event, error: "Error" });
    expect(logged).not.toContain("secret detail");
  });
});
