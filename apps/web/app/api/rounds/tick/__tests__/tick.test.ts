import { afterEach, describe, expect, it, vi } from "vitest";
import type { TickHeartbeat } from "@/modules/concierge";
import { handleTick, isTestClock } from "../tick";

// The tick takes dayOf from the concierge module, which is server-only.
vi.mock("server-only", () => ({}));

describe("isTestClock", () => {
  it("is false on production and true elsewhere", () => {
    expect(isTestClock("production")).toBe(false);
    expect(isTestClock("preview")).toBe(true);
    expect(isTestClock(undefined)).toBe(true);
  });
});

const SECRET = "s3cret";
const SUMMARY = { enabled: true, created: 1, advanced: 2, failed: 0 };
const heartbeat = () => ({
  started: vi.fn<TickHeartbeat["started"]>(async () => {}),
  finished: vi.fn<TickHeartbeat["finished"]>(async () => {}),
});
const events = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => JSON.parse(String(c[0])));
const req = (auth?: string, query = "") =>
  new Request(`https://example.test/api/rounds/tick${query}`, { headers: auth ? { authorization: auth } : {} });

afterEach(() => vi.restoreAllMocks());

describe("handleTick", () => {
  it.each([
    ["no header", undefined, SECRET],
    ["a wrong secret", "Bearer nope", SECRET],
    ["an unset secret", "Bearer undefined", undefined],
  ])("AC-16: 401 with %s, no run, and the heartbeat isn't called", async (_n, auth, cronSecret) => {
    const run = vi.fn();
    const hb = heartbeat();
    const res = await handleTick(req(auth), { cronSecret }, run, undefined, hb);
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    expect(hb.started).not.toHaveBeenCalled();
    expect(hb.finished).not.toHaveBeenCalled();
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

  it("runs the cleanup after the tick, and a throwing cleanup doesn't change the result", async () => {
    const order: string[] = [];
    const run = vi.fn(async () => {
      order.push("run");
      return SUMMARY;
    });
    const cleanup = vi.fn(async () => {
      order.push("cleanup");
      throw new Error("storage down");
    });
    const res = await handleTick(req(`Bearer ${SECRET}`), { cronSecret: SECRET }, run, cleanup);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...SUMMARY });
    expect(order).toEqual(["run", "cleanup"]);
  });

  describe("the heartbeat", () => {
    const NOW = "?now=2027-03-20T23:59:59Z";
    const ENV = { cronSecret: SECRET, vercelEnv: "preview" };

    it("a run records started then finished ok with the tick's day under ?now=", async () => {
      const order: string[] = [];
      const hb = heartbeat();
      hb.started.mockImplementation(async () => void order.push("started"));
      hb.finished.mockImplementation(async () => void order.push("finished"));
      const run = vi.fn(async () => (order.push("run"), SUMMARY));
      const res = await handleTick(req(`Bearer ${SECRET}`, NOW), ENV, run, undefined, hb);
      expect(res.status).toBe(200);
      expect(order).toEqual(["started", "run", "finished"]);
      const now = new Date("2027-03-20T23:59:59Z");
      expect(hb.started).toHaveBeenCalledWith("2027-03-20", now);
      const [day, at, result, counts] = hb.finished.mock.calls[0];
      expect(day).toBe("2027-03-20");
      // The tick's clock plus the time the run took, so the finish never lands before the start.
      expect(at.getTime()).toBeGreaterThanOrEqual(now.getTime());
      expect(at.getTime() - now.getTime()).toBeLessThan(5000);
      expect(result).toBe("ok");
      expect(counts).toEqual({ roundsFailed: 0, fanoutFailed: 0 });
    });

    it("fan-out send failures go to fanoutFailed, the rest to roundsFailed", async () => {
      const hb = heartbeat();
      const run = vi.fn().mockResolvedValue({ ...SUMMARY, failed: 5, fanoutFailed: 2 });
      await handleTick(req(`Bearer ${SECRET}`, NOW), ENV, run, undefined, hb);
      expect(hb.finished.mock.calls[0][3]).toEqual({ roundsFailed: 3, fanoutFailed: 2 });
      // Without fan-out every failure is a round's.
      run.mockResolvedValue({ ...SUMMARY, failed: 4 });
      await handleTick(req(`Bearer ${SECRET}`, NOW), ENV, run, undefined, hb);
      expect(hb.finished.mock.calls[1][3]).toEqual({ roundsFailed: 4, fanoutFailed: 0 });
    });

    it("a run that throws records failed", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const hb = heartbeat();
      const res = await handleTick(req(`Bearer ${SECRET}`, NOW), ENV, vi.fn().mockRejectedValue(new Error("boom")), undefined, hb);
      expect(res.status).toBe(500);
      expect(hb.started).toHaveBeenCalledTimes(1);
      expect(hb.finished).toHaveBeenCalledWith("2027-03-20", expect.any(Date), "failed", { roundsFailed: 0, fanoutFailed: 0 });
    });

    it("a heartbeat that throws is logged with alert and the tick still answers 200", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const hb = heartbeat();
      const err = Object.assign(new Error("Zelda at 1 Main St"), { code: "57P01" });
      hb.started.mockRejectedValue(err);
      hb.finished.mockRejectedValue(err);
      const run = vi.fn().mockResolvedValue(SUMMARY);
      const res = await handleTick(req(`Bearer ${SECRET}`, NOW), ENV, run, undefined, hb);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, ...SUMMARY });
      expect(run).toHaveBeenCalledTimes(1);
      const failed = events(log).filter((e) => e.event === "tick.heartbeat_failed");
      expect(failed).toHaveLength(2);
      for (const e of failed) expect(e).toMatchObject({ alert: true, code: "57P01" });
      expect(JSON.stringify(failed)).not.toMatch(/Zelda|Main St/);
    });
  });
});
