import type { FactCategory } from "@gifts-af/core";
import type { CandidateFact } from "@/lib/ai/extract";
import type { SavedFact } from "./extract";

export type NewCaptureRow = {
  personId: string;
  url: string;
  title: string;
  text: string;
  note: string | null;
};

export type CaptureStatus = "pending" | "extracted" | "failed";

/** A saved capture, as extraction reads it. `relationship` is the person's, never their name. */
export type StoredCapture = {
  id: string;
  personId: string;
  status: CaptureStatus;
  relationship: string;
  url: string;
  title: string;
  text: string;
  note: string | null;
  screenshotPath: string | null;
};

/** Persistence for captures; supabase-store.ts supplies the Supabase-backed version. */
export interface CaptureStore {
  limits(): Promise<{ textMaxChars: number; screenshotMaxBytes: number }>;
  /** RLS-scoped: false for a person that belongs to someone else. */
  personExists(personId: string): Promise<boolean>;
  insertCapture(row: NewCaptureRow): Promise<{ id: string; userId: string }>;
  /** Throws on failure. */
  uploadScreenshot(path: string, jpeg: Blob): Promise<void>;
  setScreenshotPath(id: string, path: string): Promise<void>;
  deleteCapture(id: string): Promise<void>;

  // Extraction (ALL-25).
  extractionSettings(): Promise<{ enabled: boolean; minConfidencePct: number; timeoutMs: number }>;
  /** Whether this user may spend money on reading (ALL-94). */
  hasPaidFeatures(): Promise<boolean>;
  /** RLS-scoped: null for an unknown or someone else's capture. */
  loadCapture(id: string): Promise<StoredCapture | null>;
  downloadScreenshot(path: string): Promise<Uint8Array>;
  /** Every fact the person has, active or removed, oldest first. */
  knownFacts(personId: string): Promise<{ category: FactCategory; value: string }[]>;
  /** Active facts saved from this capture. */
  capturedFacts(captureId: string): Promise<SavedFact[]>;
  /** Saves facts as source = capture, confirmed = false, active. */
  insertFacts(personId: string, captureId: string, facts: CandidateFact[]): Promise<SavedFact[]>;
  /** "failed" never replaces "extracted": an overlapping read may have succeeded first. */
  setCaptureStatus(id: string, status: CaptureStatus): Promise<void>;
}
