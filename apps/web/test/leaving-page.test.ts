import { describe, expect, it } from "vitest";
import { finishBeforeLeaving, onBeforeLeaving } from "@/lib/leaving-page";

// Sign out leaves with a full page load; a page with work still on its way
// (My list's held remove, ALL-127) holds it up until that's done.
describe("finishBeforeLeaving", () => {
  it("resolves at once when no page has work", async () => {
    await expect(finishBeforeLeaving()).resolves.toBeUndefined();
  });

  it("waits for each page's work, even work that fails", async () => {
    const order: string[] = [];
    let finish!: () => void;
    const stop = onBeforeLeaving(() => new Promise<void>((r) => (finish = r)).then(() => void order.push("saved")));
    const stopFailing = onBeforeLeaving(() => Promise.reject(new Error("offline")));
    const leaving = finishBeforeLeaving().then(() => order.push("left"));
    await Promise.resolve();
    expect(order).toEqual([]);
    finish();
    await leaving;
    expect(order).toEqual(["saved", "left"]);
    stop();
    stopFailing();
  });

  it("stops asking a page once it unsubscribes", async () => {
    let asked = 0;
    const stop = onBeforeLeaving(async () => void asked++);
    stop();
    await finishBeforeLeaving();
    expect(asked).toBe(0);
  });
});
