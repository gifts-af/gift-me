// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { handleTick } from "../tick";

const SECRET = "s3cret";
const SUMMARY = { enabled: true, created: 1, advanced: 2, failed: 0 };
const req = (auth?: string, query = "") =>
  new Request(`https://example.test/api/rounds/tick${query}`, { headers: auth ? { authorization: auth } : {} });

describe("handleTick", () => {
  it.each([
    ["no header", undefined, SECRET],
    ["a wrong secret", "Bearer nope", SECRET],
    ["an unset secret", "Bearer undefined", undefined],
  ])("401 and no run with %s", async (_n, auth, cronSecret) => {
    const run = vi.fn();
    const res = await handleTick(req(auth), { cronSecret }, run);
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("passes ?now= outside production", async () => {
    const run = vi.fn().mockResolvedValue(SUMMARY);
    const res = await handleTick(
      req(`Bearer ${SECRET}`, "?now=2027-03-20T12:00:00Z"),
      { cronSecret: SECRET, vercelEnv: "preview" },
      run,
    );
    expect(run).toHaveBeenCalledWith(new Date("2027-03-20T12:00:00Z"));
    expect(await res.json()).toEqual({ ok: true, ...SUMMARY });
  });

  it("ignores ?now= in production (AC-13)", async () => {
    const run = vi.fn().mockResolvedValue(SUMMARY);
    const before = Date.now();
    await handleTick(
      req(`Bearer ${SECRET}`, "?now=2027-03-20T12:00:00Z"),
      { cronSecret: SECRET, vercelEnv: "production" },
      run,
    );
    const used = (run.mock.calls[0][0] as Date).getTime();
    expect(used).toBeGreaterThanOrEqual(before);
    expect(used).toBeLessThanOrEqual(Date.now());
  });

  it("uses the real time when ?now= doesn't parse", async () => {
    const run = vi.fn().mockResolvedValue(SUMMARY);
    await handleTick(req(`Bearer ${SECRET}`, "?now=garbage"), { cronSecret: SECRET, vercelEnv: "preview" }, run);
    expect(Math.abs((run.mock.calls[0][0] as Date).getTime() - Date.now())).toBeLessThan(5000);
  });

  it("500 when the run throws", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await handleTick(req(`Bearer ${SECRET}`), { cronSecret: SECRET }, async () => {
      throw new Error("boom");
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
    spy.mockRestore();
  });
});
