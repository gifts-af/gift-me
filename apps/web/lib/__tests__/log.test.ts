// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "../log";

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
