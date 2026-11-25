import { afterEach, describe, expect, it, vi } from "vitest";
import vercelJson from "../../../../../vercel.json";
import { strayKeys } from "@/test/fanout-event-keys";
import { signMessage } from "../../sign";
import { handleJob, jobMaxConcurrency } from "../job";

// The job imports the tick, which takes dayOf from the concierge module (server-only).
vi.mock("server-only", () => ({}));

const SECRET = "s3cret";
const ENV = { cronSecret: SECRET };
const sign = (m: object) => signMessage(m, SECRET);

const U = "0b6f7c3e-1a2b-4c5d-8e9f-001122334455";
const events = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => JSON.parse(String(c[0])));

afterEach(() => vi.restoreAllMocks());

describe("handleJob", () => {
  it("runs a valid signed round and buyer message, without the sig", async () => {
    const run = vi.fn().mockResolvedValue("advanced");
    expect(await handleJob(sign({ kind: "round", roundId: U }), { deliveryCount: 1 }, ENV, run)).toBe("advanced");
    expect(run.mock.calls[0][0]).toEqual({ kind: "round", roundId: U });
    await handleJob(sign({ kind: "buyer", userId: U, roundIds: [U] }), { deliveryCount: 1 }, ENV, run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).toEqual({ kind: "buyer", userId: U, roundIds: [U] });
  });

  it.each([
    ["a bad kind", { kind: "other", roundId: U }],
    ["a bad uuid", { kind: "round", roundId: "nope" }],
    ["empty roundIds", { kind: "buyer", userId: U, roundIds: [] }],
    ["a bad now", { kind: "round", roundId: U, now: "soon" }],
    ["retry 0", { kind: "round", roundId: U, retry: 0 }],
    ["retry -1", { kind: "round", roundId: U, retry: -1 }],
    ["retry 1.5", { kind: "round", roundId: U, retry: 1.5 }],
    ['retry "1"', { kind: "round", roundId: U, retry: "1" }],
    ["null", null],
  ])("acknowledges %s as invalid and logs it", async (_n, raw) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn();
    expect(await handleJob(raw && sign(raw), { deliveryCount: 1 }, ENV, run)).toBe("invalid");
    expect(run).not.toHaveBeenCalled();
    expect(events(log)).toContainEqual({ event: "round_job", at: expect.any(String), result: "invalid", delivery_count: 1 });
  });

  describe("signature", () => {
    const refused = async (raw: unknown, env: object) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const run = vi.fn();
      expect(await handleJob(raw, { deliveryCount: 1 }, env, run)).toBe("invalid");
      expect(run).not.toHaveBeenCalled();
      expect(events(log)).toContainEqual(
        expect.objectContaining({ event: "round_job", result: "invalid", reason: "bad_signature", alert: true }),
      );
    };
    const V = "1b6f7c3e-1a2b-4c5d-8e9f-001122334455";

    it("refuses a tampered body", async () => {
      const signed = sign({ kind: "buyer", userId: U, roundIds: [U] });
      await refused({ ...signed, roundIds: [V] }, ENV);
    });
    it("refuses a changed retry", async () => {
      await refused({ ...sign({ kind: "round", roundId: U, retry: 1 }), retry: 2 }, ENV);
    });
    it("refuses a missing or malformed sig", async () => {
      await refused({ kind: "round", roundId: U }, ENV);
      await refused({ kind: "round", roundId: U, sig: "zz" }, ENV);
    });
    it("refuses a sig made with another secret", async () => {
      await refused(signMessage({ kind: "round", roundId: U }, "other"), ENV);
    });
    it("refuses everything when CRON_SECRET is unset", async () => {
      await refused(sign({ kind: "round", roundId: U }), {});
    });
  });

  it("ignores the message's now on production, uses it elsewhere (AC-13)", async () => {
    const run = vi.fn().mockResolvedValue("advanced");
    const msg = sign({ kind: "round", roundId: U, now: "2027-03-20T12:00:00.000Z" });
    const before = Date.now();
    await handleJob(msg, { deliveryCount: 1 }, { ...ENV, vercelEnv: "production" }, run);
    expect(run.mock.calls[0][1].getTime()).toBeGreaterThanOrEqual(before);
    await handleJob(msg, { deliveryCount: 1 }, { ...ENV, vercelEnv: "preview" }, run);
    expect(run.mock.calls[1][1]).toEqual(new Date("2027-03-20T12:00:00.000Z"));
  });

  it("runs a signed follow-up, its retry count included, with its now only off production", async () => {
    const run = vi.fn().mockResolvedValue("waiting");
    const at = "2027-03-20T12:00:00.000Z";
    const msg = sign({ kind: "round", roundId: U, retry: 1, now: at });
    const before = Date.now();
    await handleJob(msg, { deliveryCount: 1 }, { ...ENV, vercelEnv: "preview" }, run);
    expect(run.mock.calls[0]).toEqual([{ kind: "round", roundId: U, retry: 1, now: at }, new Date(at)]);
    await handleJob(msg, { deliveryCount: 1 }, { ...ENV, vercelEnv: "production" }, run);
    expect(run.mock.calls[1][1].getTime()).toBeGreaterThanOrEqual(before);
    expect(run.mock.calls[1][1].getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("logs only ids, counts, flags and enums (AC-17, E6)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const meta = { deliveryCount: 2 };
    await handleJob(null, meta, ENV, vi.fn());
    await handleJob({ kind: "round", roundId: U }, meta, ENV, vi.fn());
    await expect(
      handleJob(sign({ kind: "buyer", userId: U, roundIds: [U] }), meta, ENV, vi.fn().mockRejectedValue(new Error("Zelda"))),
    ).rejects.toThrow();
    const mine = events(log).filter((e) => e.event === "round_job");
    expect(mine).toHaveLength(3);
    expect(strayKeys(mine)).toEqual([]);
  });

  it("logs an alert and rethrows when run throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue(new Error("wiring"));
    await expect(handleJob(sign({ kind: "round", roundId: U }), { deliveryCount: 2 }, ENV, run)).rejects.toThrow("wiring");
    expect(events(log)).toContainEqual(
      expect.objectContaining({ event: "round_job", result: "failed", delivery_count: 2, alert: true }),
    );
  });

  it("rethrows a failure before any claim (a setting read) with the error's fields, never its message", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // A message throws only before it claims a round, e.g. when round_fanout_enabled can't be read.
    // An error's own kind (a ZincError's) never overwrites the message's kind.
    const err = Object.assign(new Error("Zelda at 1 Main St"), { code: "57P01", kind: "unavailable" });
    const run = vi.fn().mockRejectedValue(err);
    await expect(handleJob(sign({ kind: "buyer", userId: U, roundIds: [U] }), { deliveryCount: 1 }, ENV, run)).rejects.toBe(err);
    const mine = events(log).filter((e) => e.event === "round_job");
    expect(mine).toEqual([
      expect.objectContaining({ kind: "buyer", result: "failed", user_id: U, delivery_count: 1, alert: true, code: "57P01" }),
    ]);
    expect(JSON.stringify(mine)).not.toMatch(/Zelda|Main St/);
  });

  it("acknowledges a failure after a claim (run resolves failed): no alert, no rethrow", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn().mockResolvedValue("failed");
    expect(await handleJob(sign({ kind: "round", roundId: U }), { deliveryCount: 1 }, ENV, run)).toBe("failed");
    expect(events(log).filter((e) => e.alert)).toEqual([]);
  });
});

describe("vercel.json", () => {
  it("has the round-jobs trigger on the job route, and the route reads maxConcurrency 5", () => {
    const trigger = vercelJson.functions["app/api/rounds/job/route.ts"].experimentalTriggers[0];
    expect(trigger).toMatchObject({ type: "queue/v2beta", topic: "round-jobs", maxDeliveries: 3 });
    expect(jobMaxConcurrency(vercelJson)).toBe(5);
  });

  it("rejects a maxConcurrency below 1", () => {
    const bad = {
      functions: { "app/api/rounds/job/route.ts": { experimentalTriggers: [{ topic: "round-jobs", maxConcurrency: 0 }] } },
    };
    expect(() => jobMaxConcurrency(bad)).toThrow();
  });
});

describe("handleJob's onFailed", () => {
  const msg = () => sign({ kind: "round", roundId: U });

  it("AC-7: a failed result calls onFailed once", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const onFailed = vi.fn(async () => {});
    const at = "2027-03-20T12:00:00.000Z";
    const result = await handleJob(sign({ kind: "round", roundId: U, now: at }), { deliveryCount: 1 }, { ...ENV, vercelEnv: "preview" }, vi.fn().mockResolvedValue("failed"), onFailed);
    expect(result).toBe("failed");
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed).toHaveBeenCalledWith({ kind: "round", roundId: U, now: at }, new Date(at));
  });

  it.each(["advanced", "waiting", "busy", "off"])("a %s result doesn't", async (r) => {
    const onFailed = vi.fn(async () => {});
    expect(await handleJob(msg(), { deliveryCount: 1 }, ENV, vi.fn().mockResolvedValue(r), onFailed)).toBe(r);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("an invalid message doesn't", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const onFailed = vi.fn(async () => {});
    expect(await handleJob(null, { deliveryCount: 1 }, ENV, vi.fn(), onFailed)).toBe("invalid");
    expect(await handleJob({ kind: "round", roundId: U }, { deliveryCount: 1 }, ENV, vi.fn(), onFailed)).toBe("invalid");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("an onFailed that throws is logged and the result is unchanged", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const onFailed = vi.fn().mockRejectedValue(Object.assign(new Error("Zelda at 1 Main St"), { code: "57P01" }));
    expect(await handleJob(msg(), { deliveryCount: 1 }, ENV, vi.fn().mockResolvedValue("failed"), onFailed)).toBe("failed");
    const failed = events(log).filter((e) => e.event === "tick.heartbeat_failed");
    expect(failed).toEqual([expect.objectContaining({ alert: true, code: "57P01", round_id: U })]);
    expect(JSON.stringify(failed)).not.toMatch(/Zelda|Main St/);
  });

  it("a run that throws doesn't call onFailed (the queue redelivers it)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const onFailed = vi.fn(async () => {});
    await expect(handleJob(msg(), { deliveryCount: 1 }, ENV, vi.fn().mockRejectedValue(new Error("wiring")), onFailed)).rejects.toThrow("wiring");
    expect(onFailed).not.toHaveBeenCalled();
  });
});
