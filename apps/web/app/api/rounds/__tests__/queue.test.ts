// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { QueuedJob } from "@/modules/concierge";
import { sendJobsWith } from "../queue";

const U = "0b6f7c3e-1a2b-4c5d-8e9f-001122334455";
const jobs = (n: number): QueuedJob[] =>
  Array.from({ length: n }, (_, i) => ({ message: { kind: "round", roundId: U }, idempotencyKey: `k${i}` }));
const ok = { status: "sent", messageId: "m" } as const;
const fail = (retryable: boolean) => ({ status: "failed", statusCode: 500, error: "x", retryable }) as const;

describe("sendJobsWith", () => {
  it("sends 150 jobs as batches of 100 and 50 with their keys", async () => {
    const sendBatch = vi.fn(async (_t: string, m: readonly unknown[]) => m.map(() => ok));
    const res = await sendJobsWith(sendBatch as never)(jobs(150));
    expect(res).toEqual({ sent: 150, failed: 0 });
    expect(sendBatch).toHaveBeenCalledTimes(2);
    const [topic, first] = sendBatch.mock.calls[0] as unknown as [string, { idempotencyKey: string; payload: unknown }[]];
    expect(topic).toBe("round-jobs");
    expect(first).toHaveLength(100);
    expect(first[3]).toEqual({ payload: { kind: "round", roundId: U }, idempotencyKey: "k3" });
    expect(sendBatch.mock.calls[1][1]).toHaveLength(50);
  });

  it("counts deferred as sent", async () => {
    const sendBatch = vi.fn(async () => [{ status: "deferred", messageId: null }]);
    expect(await sendJobsWith(sendBatch as never)(jobs(1))).toEqual({ sent: 1, failed: 0 });
  });

  it("re-sends a retryable failure once and counts it sent", async () => {
    const sendBatch = vi.fn().mockResolvedValueOnce([ok, fail(true)]).mockResolvedValueOnce([ok]);
    const res = await sendJobsWith(sendBatch as never)(jobs(2));
    expect(res).toEqual({ sent: 2, failed: 0 });
    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(sendBatch.mock.calls[1][1]).toEqual([expect.objectContaining({ idempotencyKey: "k1" })]);
  });

  it("does not re-send twice when the retry fails again", async () => {
    const sendBatch = vi.fn().mockResolvedValueOnce([fail(true)]).mockResolvedValueOnce([fail(true)]);
    expect(await sendJobsWith(sendBatch as never)(jobs(1))).toEqual({ sent: 0, failed: 1 });
    expect(sendBatch).toHaveBeenCalledTimes(2);
  });

  it("counts a non-retryable failure failed, without re-sending", async () => {
    const sendBatch = vi.fn().mockResolvedValue([ok, fail(false)]);
    expect(await sendJobsWith(sendBatch as never)(jobs(2))).toEqual({ sent: 1, failed: 1 });
    expect(sendBatch).toHaveBeenCalledTimes(1);
  });

  it("counts a thrown batch's messages failed", async () => {
    const sendBatch = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce([ok]);
    expect(await sendJobsWith(sendBatch as never)(jobs(101))).toEqual({ sent: 1, failed: 100 });
  });
});
