// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import vercelJson from "../../../../../vercel.json";
import { handleJob, jobMaxConcurrency } from "../job";

const U = "0b6f7c3e-1a2b-4c5d-8e9f-001122334455";
const events = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => JSON.parse(String(c[0])));

afterEach(() => vi.restoreAllMocks());

describe("handleJob", () => {
  it("runs a valid round and buyer message", async () => {
    const run = vi.fn().mockResolvedValue("advanced");
    expect(await handleJob({ kind: "round", roundId: U }, { deliveryCount: 1 }, {}, run)).toBe("advanced");
    expect(run.mock.calls[0][0]).toEqual({ kind: "round", roundId: U });
    await handleJob({ kind: "buyer", userId: U, roundIds: [U] }, { deliveryCount: 1 }, {}, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a bad kind", { kind: "other", roundId: U }],
    ["a bad uuid", { kind: "round", roundId: "nope" }],
    ["empty roundIds", { kind: "buyer", userId: U, roundIds: [] }],
    ["a bad now", { kind: "round", roundId: U, now: "soon" }],
    ["null", null],
  ])("acknowledges %s as invalid and logs it", async (_n, raw) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn();
    expect(await handleJob(raw, { deliveryCount: 1 }, {}, run)).toBe("invalid");
    expect(run).not.toHaveBeenCalled();
    expect(events(log)).toContainEqual(expect.objectContaining({ event: "round_job", result: "invalid" }));
  });

  it("ignores the message's now on production, uses it elsewhere (AC-13)", async () => {
    const run = vi.fn().mockResolvedValue("advanced");
    const msg = { kind: "round", roundId: U, now: "2027-03-20T12:00:00.000Z" };
    const before = Date.now();
    await handleJob(msg, { deliveryCount: 1 }, { vercelEnv: "production" }, run);
    expect(run.mock.calls[0][1].getTime()).toBeGreaterThanOrEqual(before);
    await handleJob(msg, { deliveryCount: 1 }, { vercelEnv: "preview" }, run);
    expect(run.mock.calls[1][1]).toEqual(new Date("2027-03-20T12:00:00.000Z"));
  });

  it("logs an alert and rethrows when run throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue(new Error("wiring"));
    await expect(handleJob({ kind: "round", roundId: U }, { deliveryCount: 2 }, {}, run)).rejects.toThrow("wiring");
    expect(events(log)).toContainEqual(
      expect.objectContaining({ event: "round_job", result: "failed", delivery_count: 2, alert: true }),
    );
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
