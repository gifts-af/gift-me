import { factLine, stripContactDetails, type FactCategory } from "@gifts-af/core";
import type { CandidateFact, Extract, Reading } from "@/lib/ai/extract";
import { callRefused } from "@/lib/ai/refused";
import { isSensitive } from "@/lib/ai/sensitive";
import { logEvent } from "@/lib/log";
import type { RecordCost } from "../costs/record";
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
  return `${category}:${valueKey(value)}`;
}

/** A value as `profile_facts.value_key` and its unique index compare it: trimmed, spaces collapsed, lower case. */
export function valueKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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
 * Records what the model call cost, once, unless it was refused; a recorder that throws changes nothing.
 */
export async function processCapture(
  store: CaptureStore,
  extract: Extract,
  recordCost: RecordCost,
  captureId: string,
): Promise<Extraction> {
  const capture = await store.loadCapture(captureId);
  if (!capture) throw new CaptureNotFound();
  if (capture.status === "extracted") {
    return { status: "extracted", facts: await store.capturedFacts(captureId) };
  }

  const settings = await store.extractionSettings();
  if (!settings.enabled) return { status: "pending", facts: [] };

  const ids = { capture_id: capture.id, person_id: capture.personId };
  // The capture stays saved and unread (ALL-94, decision 53).
  if (!(await store.hasPaidFeatures())) {
    logEvent("capture.read_needs_paid_features", { ...ids, user_id: store.userId });
    return { status: "pending", facts: [] };
  }

  // Null cents: the call may have been charged, but nothing says how much.
  const record = async (cents: number | null) => {
    try {
      await recordCost({
        userId: store.userId,
        kind: "ai_capture",
        cents: cents ?? settings.readEstimateCents,
        estimated: cents === null,
      });
    } catch {
      // A cost is bookkeeping: the read goes on without it.
    }
  };
  // Runs while the facts are saved, so recording doesn't hold them up.
  let recording: Promise<void> | undefined;

  const started = Date.now();
  try {
    const known = await store.knownFacts(capture.personId);
    const screenshot = capture.screenshotPath
      ? { bytes: await store.downloadScreenshot(capture.screenshotPath), type: capture.screenshotType }
      : null;
    // Contact details stay out of what the model reads (T42, ALL-134): the buyer's own words (the
    // note, and an emailed note's subject and body, which has no URL) are stripped; a page's text,
    // title and URL are the store's and go as written. What's saved is unchanged.
    const emailed = !capture.url;
    const input = {
      relationship: capture.relationship,
      url: capture.url,
      title: emailed ? stripContactDetails(capture.title) : capture.title,
      text: emailed ? stripContactDetails(capture.text) : capture.text,
      note: capture.note === null ? null : stripContactDetails(capture.note),
      screenshot,
      // Contact details stay out of what the model reads (T42, ALL-134); the duplicate check below uses the real values.
      known: known.map((f) => stripContactDetails(factLine(f.category, f.value))),
    };
    let reading: Reading;
    try {
      reading = await extract(input, { timeoutMs: settings.timeoutMs });
    } catch (err) {
      if (!callRefused(err)) recording = record(null);
      throw err;
    }
    recording = record(reading.costCents);
    const { keep, blocked } = selectFacts(
      reading.facts,
      new Set(known.map((f) => factKey(f.category, f.value))),
      settings.minConfidencePct,
    );
    const facts = keep.length > 0 ? await store.insertFacts(capture.personId, capture.id, keep) : [];
    await store.setCaptureStatus(capture.id, "extracted");
    logEvent("capture.extracted", { ...ids, facts: facts.length, blocked, ms: Date.now() - started });
    return { status: "extracted", facts };
  } catch (err) {
    // The error's message may quote the page, so only its type is logged.
    logEvent("capture.extract_failed", { ...ids, error: err instanceof Error ? err.name : "unknown", ms: Date.now() - started });
    await store.setCaptureStatus(capture.id, "failed");
    return { status: "failed", facts: [] };
  } finally {
    await recording;
  }
}
