// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorFields, logEvent } from "../log";

describe("logEvent", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  afterEach(() => log.mockClear());

  it("writes one JSON line with the event name, time and fields", () => {
    logEvent("capture.extracted", { capture_id: "c1", facts: 2 });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ event: "capture.extracted", capture_id: "c1", facts: 2 });
    expect(new Date(parsed.at).toISOString()).toBe(parsed.at);
  });
});

describe("errorFields", () => {
  it("keeps an error's name, kind and code, never its message", () => {
    const e = Object.assign(new Error("secret text zn_test_KEY"), { name: "ZincError", kind: "unavailable", code: "malformed_response", status: 502 });
    expect(errorFields(e)).toEqual({ name: "ZincError", kind: "unavailable", code: "malformed_response", status: 502 });
    expect(JSON.stringify(errorFields(e))).not.toContain("secret");
    expect(errorFields(Object.assign(new Error("x"), { code: "P0001" }))).toEqual({ name: "Error", code: "P0001" });
    expect(errorFields("boom")).toEqual({ name: "unknown" });
  });

  it("leaves out a kind or code that isn't a short plain token", () => {
    const e = Object.assign(new Error("x"), { code: "a@b.com mary's address", kind: { nested: true } });
    expect(errorFields(e)).toEqual({ name: "Error" });
  });
});
