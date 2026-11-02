// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { CandidateFact, ExtractInput } from "@/lib/ai/extract";
import { CaptureNotFound, factKey, processCapture, selectFacts } from "../capture/extract";
import type { StoredCapture } from "../capture/store";
import { FakeCaptureStore } from "./fake-capture-store";

const fact = (category: CandidateFact["category"], value: string, confidence = 0.9): CandidateFact => ({
  category,
  value,
  confidence,
});

describe("factKey", () => {
  it("ignores case and spacing", () => {
    expect(factKey("owns", "  Owala   Water bottle ")).toBe(factKey("owns", "owala water bottle"));
  });

  it("keeps categories apart", () => {
    expect(factKey("owns", "vise")).not.toBe(factKey("wants", "vise"));
  });
});

describe("selectFacts", () => {
  it("drops facts under the confidence cut and keeps those at or above it", () => {
    const { keep } = selectFacts([fact("wants", "a", 0.4), fact("wants", "b", 0.8), fact("wants", "c", 0.6)], new Set(), 60);
    expect(keep.map((f) => f.value)).toEqual(["b", "c"]);
  });

  it("drops sensitive facts and counts them", () => {
    const { keep, blocked } = selectFacts([fact("constraint", "takes blood pressure meds"), fact("wants", "vise")], new Set(), 60);
    expect(keep.map((f) => f.value)).toEqual(["vise"]);
    expect(blocked).toBe(1);
  });

  it("drops facts the person already has, including removed ones", () => {
    const { keep } = selectFacts([fact("owns", "Owala bottle")], new Set([factKey("owns", "owala bottle")]), 60);
    expect(keep).toEqual([]);
  });

  it("keeps one of two identical facts in the same output", () => {
    const { keep } = selectFacts([fact("owns", "Kettle"), fact("owns", "kettle")], new Set(), 60);
    expect(keep).toHaveLength(1);
  });
});

describe("processCapture", () => {
  let store: FakeCaptureStore;
  let log: MockInstance<typeof console.log>;
  let calls: ExtractInput[];
  let timeouts: number[];
  let reply: () => Promise<CandidateFact[]>;
  const extract = async (input: ExtractInput, options: { timeoutMs: number }) => {
    calls.push(input);
    timeouts.push(options.timeoutMs);
    return reply();
  };

  function capture(over: Partial<StoredCapture> = {}): StoredCapture {
    const c: StoredCapture = {
      id: "cap-1",
      personId: "p1",
      status: "pending",
      relationship: "father",
      url: "https://www.instagram.com/p/x",
      title: "Instagram",
      text: "My vise gave out",
      note: null,
      screenshotPath: "user-1/cap-1.jpg",
      ...over,
    };
    store.captures.set(c.id, c);
    return c;
  }

  beforeEach(() => {
    store = new FakeCaptureStore();
    store.screenshots.set("user-1/cap-1.jpg", new Uint8Array([1, 2, 3]));
    calls = [];
    timeouts = [];
    reply = async () => [fact("wants", "a new rotary vise"), fact("owns", "old vise", 0.3)];
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
  });

  it("saves the kept facts and marks the capture extracted", async () => {
    capture();
    const result = await processCapture(store, extract, "cap-1");
    expect(result.status).toBe("extracted");
    expect(result.facts.map((f) => f.value)).toEqual(["a new rotary vise"]);
    expect(store.facts).toHaveLength(1);
    expect(store.captures.get("cap-1")!.status).toBe("extracted");
  });

  it("sends the relationship and screenshot, not a name", async () => {
    capture();
    await processCapture(store, extract, "cap-1");
    expect(calls[0].relationship).toBe("father");
    expect(calls[0].screenshot).toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.keys(calls[0])).not.toContain("name");
  });

  it("gives the model the timeout from settings", async () => {
    capture();
    store.extraction.timeoutMs = 1234;
    await processCapture(store, extract, "cap-1");
    expect(timeouts).toEqual([1234]);
  });

  it("marks a page with nothing confident as extracted with no facts", async () => {
    capture();
    reply = async () => [];
    const result = await processCapture(store, extract, "cap-1");
    expect(result).toEqual({ status: "extracted", facts: [] });
  });

  it("marks failed and saves nothing when the model call throws", async () => {
    capture();
    reply = async () => {
      throw new Error("gateway down");
    };
    const result = await processCapture(store, extract, "cap-1");
    expect(result).toEqual({ status: "failed", facts: [] });
    expect(store.facts).toEqual([]);
    expect(store.captures.get("cap-1")!.status).toBe("failed");
  });

  it("leaves the capture pending and skips the model when extraction is off", async () => {
    capture();
    store.extraction.enabled = false;
    const result = await processCapture(store, extract, "cap-1");
    expect(result).toEqual({ status: "pending", facts: [] });
    expect(calls).toEqual([]);
  });

  it("reads a failed capture again", async () => {
    capture({ status: "failed" });
    const result = await processCapture(store, extract, "cap-1");
    expect(result.status).toBe("extracted");
    expect(calls).toHaveLength(1);
  });

  it("returns an extracted capture's facts without reading it again", async () => {
    capture();
    await processCapture(store, extract, "cap-1");
    const again = await processCapture(store, extract, "cap-1");
    expect(calls).toHaveLength(1);
    expect(again.facts.map((f) => f.value)).toEqual(["a new rotary vise"]);
    expect(store.facts).toHaveLength(1);
  });

  it("works with text only when there's no screenshot", async () => {
    capture({ screenshotPath: null });
    await processCapture(store, extract, "cap-1");
    expect(store.downloads).toEqual([]);
    expect(calls[0].screenshot).toBeNull();
  });

  it("throws CaptureNotFound for an unknown or someone else's capture", async () => {
    await expect(processCapture(store, extract, "nope")).rejects.toBeInstanceOf(CaptureNotFound);
  });

  it("logs one event with ids and counts only", async () => {
    capture({ text: "secret page text" });
    reply = async () => [fact("wants", "a new rotary vise"), fact("constraint", "on chemo")];
    await processCapture(store, extract, "cap-1");
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    const event = lines.find((l) => l.event === "capture.extracted");
    expect(event).toMatchObject({ capture_id: "cap-1", person_id: "p1", facts: 1, blocked: 1 });
    expect(typeof event.ms).toBe("number");
    expect(JSON.stringify(lines)).not.toMatch(/rotary|chemo|secret|Instagram/);
  });

  it("logs a failure event without the error's text", async () => {
    capture();
    reply = async () => {
      throw new Error("gateway said: My vise gave out");
    };
    await processCapture(store, extract, "cap-1");
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(lines.find((l) => l.event === "capture.extract_failed")).toMatchObject({ capture_id: "cap-1", person_id: "p1" });
    expect(JSON.stringify(lines)).not.toMatch(/vise/);
  });
});
