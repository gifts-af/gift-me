import type { FactCategory } from "@gifts-af/core";
import type { CandidateFact, Extract } from "@/lib/ai/extract";
import { isSensitive } from "@/lib/ai/sensitive";
import { logEvent } from "@/lib/log";
import type { CaptureStore } from "./store";

// Reading a capture into profile facts (ALL-25, D47, T48). Saved facts are
// active straight away and marked as AI suggestions (source = capture).

export type SavedFact = { id: string; category: FactCategory; value: string };
export type Extraction = { status: "extracted" | "failed" | "pending"; facts: SavedFact[] };

export class CaptureNotFound extends Error {
  constructor() {
    super("capture not found");
  }
}

/** Two facts are the same when category and value match, ignoring case and spacing. */
export function factKey(category: string, value: string): string {
  return `${category}:${value.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

/** Keeps confident, non-sensitive facts the person doesn't already have (active or removed). */
export function selectFacts(
  candidates: CandidateFact[],
  existingKeys: Set<string>,
  minConfidencePct: number,
): { keep: CandidateFact[]; blocked: number } {
  const seen = new Set(existingKeys);
  const keep: CandidateFact[] = [];
  let blocked = 0;
  for (const fact of candidates) {
    if (isSensitive(fact.value)) {
      blocked++;
      continue;
    }
    if (fact.confidence * 100 < minConfidencePct) continue;
    const key = factKey(fact.category, fact.value);
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(fact);
  }
  return { keep, blocked };
}

/**
 * Reads one pending or failed capture with the model and saves what it learned.
 * An already-extracted capture returns its facts without calling the model again.
 */
export async function processCapture(store: CaptureStore, extract: Extract, captureId: string): Promise<Extraction> {
  const capture = await store.loadCapture(captureId);
  if (!capture) throw new CaptureNotFound();
  if (capture.status === "extracted") {
    return { status: "extracted", facts: await store.capturedFacts(captureId) };
  }

  const settings = await store.extractionSettings();
  if (!settings.enabled) return { status: "pending", facts: [] };

  const ids = { capture_id: capture.id, person_id: capture.personId };
  const started = Date.now();
  try {
    const screenshot = capture.screenshotPath ? await store.downloadScreenshot(capture.screenshotPath) : null;
    const candidates = await extract({
      relationship: capture.relationship,
      url: capture.url,
      title: capture.title,
      text: capture.text,
      note: capture.note,
      screenshot,
    });
    const { keep, blocked } = selectFacts(candidates, await store.factKeys(capture.personId), settings.minConfidencePct);
    const facts = keep.length > 0 ? await store.insertFacts(capture.personId, capture.id, keep) : [];
    await store.setCaptureStatus(capture.id, "extracted");
    logEvent("capture.extracted", { ...ids, facts: facts.length, blocked, ms: Date.now() - started });
    return { status: "extracted", facts };
  } catch (err) {
    // The error's message may quote the page, so only its type is logged.
    logEvent("capture.extract_failed", { ...ids, error: err instanceof Error ? err.name : "unknown", ms: Date.now() - started });
    await store.setCaptureStatus(capture.id, "failed");
    return { status: "failed", facts: [] };
  }
}
