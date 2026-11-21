// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { QueuedJob } from "@/modules/concierge";
import { strayKeys } from "@/test/fanout-event-keys";
import { sendJobsWith as withSecret } from "../queue";
import { verifyMessage } from "../sign";

const SECRET = "s3cret";
const sendJobsWith = (send: never) => withSecret(send, SECRET);

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
    expect(first[3]).toEqual({ payload: { kind: "round", roundId: U, sig: expect.any(String) }, idempotencyKey: "k3" });
    // Every message carries a signature the job route accepts.
    for (const m of first) expect(verifyMessage(m.payload as { sig: string }, SECRET)).toBe(true);
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

  it("re-sends a thrown batch once with the same keys and counts it sent", async () => {
    // A request-level error can follow the queue's acceptance; the idempotency keys make the resend safe.
    const sendBatch = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce([ok, ok]);
    expect(await sendJobsWith(sendBatch as never)(jobs(2))).toEqual({ sent: 2, failed: 0 });
    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(sendBatch.mock.calls[1][1]).toEqual(sendBatch.mock.calls[0][1]);
  });

  it("counts a batch that throws twice failed, and sends the next batch", async () => {
    const sendBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([ok]);
    expect(await sendJobsWith(sendBatch as never)(jobs(101))).toEqual({ sent: 1, failed: 100 });
    expect(sendBatch).toHaveBeenCalledTimes(3);
  });

  it("counts messages the queue returned no result for as failed", async () => {
    const sendBatch = vi.fn().mockResolvedValue([ok]);
    expect(await sendJobsWith(sendBatch as never)(jobs(3))).toEqual({ sent: 1, failed: 2 });
  });

  it("logs a thrown batch with its error's name, never its message", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const sendBatch = vi.fn().mockRejectedValue(new TypeError("secret detail"));
    await sendJobsWith(sendBatch as never)(jobs(1));
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ event: "round_fanout_send_threw", count: 1, name: "TypeError" });
    expect(line).not.toContain("secret detail");
    expect(strayKeys([JSON.parse(line)])).toEqual([]);
    log.mockRestore();
  });
});
