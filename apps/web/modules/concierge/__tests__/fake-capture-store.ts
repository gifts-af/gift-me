import type { CandidateFact } from "@/lib/ai/extract";
import type { SavedFact } from "../capture/extract";
import type { CaptureStatus, CaptureStore, NewCaptureRow, StoredCapture } from "../capture/store";

export type FakeCaptureRow = NewCaptureRow & {
  id: string;
  userId: string;
  screenshotPath: string | null;
};

/** In-memory CaptureStore for unit tests. */
export class FakeCaptureStore implements CaptureStore {
  limitValues = { textMaxChars: 20000, screenshotMaxBytes: 2500000 };
  people = new Set<string>();
  userId = "user-1";
  rows: FakeCaptureRow[] = [];
  uploads = new Map<string, Blob>();
  failLimits = false;
  failPersonCheck = false;
  failInsert = false;
  failUpload = false;
  failSetPath = false;
  failDelete = false;
  private n = 0;
  // Extraction (ALL-25).
  extraction = { enabled: true, minConfidencePct: 60, timeoutMs: 40000 };
  captures = new Map<string, StoredCapture>();
  screenshots = new Map<string, Uint8Array>();
  facts: (SavedFact & { personId: string; captureId: string | null; active: boolean })[] = [];
  downloads: string[] = [];
  failInsertFacts = false;

  async limits() {
    if (this.failLimits) throw new Error("limits failed");
    return this.limitValues;
  }
  async personExists(personId: string) {
    if (this.failPersonCheck) throw new Error("person check failed");
    return this.people.has(personId);
  }
  async insertCapture(row: NewCaptureRow) {
    if (this.failInsert) throw new Error("insert failed");
    const id = `cap-${++this.n}`;
    this.rows.push({ ...row, id, userId: this.userId, screenshotPath: null });
    return { id, userId: this.userId };
  }
  async uploadScreenshot(path: string, jpeg: Blob) {
    if (this.failUpload) throw new Error("upload failed");
    this.uploads.set(path, jpeg);
  }
  async setScreenshotPath(id: string, path: string) {
    if (this.failSetPath) throw new Error("set path failed");
    const row = this.rows.find((r) => r.id === id);
    if (row) row.screenshotPath = path;
  }
  async deleteCapture(id: string) {
    if (this.failDelete) throw new Error("delete failed");
    this.rows = this.rows.filter((r) => r.id !== id);
  }

  async extractionSettings() {
    return this.extraction;
  }
  async loadCapture(id: string) {
    return this.captures.get(id) ?? null;
  }
  async downloadScreenshot(path: string) {
    this.downloads.push(path);
    const bytes = this.screenshots.get(path);
    if (!bytes) throw new Error("no such screenshot");
    return bytes;
  }
  async knownFacts(personId: string) {
    return this.facts.filter((f) => f.personId === personId).map(({ category, value }) => ({ category, value }));
  }
  async capturedFacts(captureId: string) {
    return this.facts
      .filter((f) => f.captureId === captureId && f.active)
      .map(({ id, category, value }) => ({ id, category, value }));
  }
  async insertFacts(personId: string, captureId: string, facts: CandidateFact[]) {
    if (this.failInsertFacts) throw new Error("insert facts failed");
    return facts.map((f) => {
      const saved = { id: `fact-${++this.n}`, category: f.category, value: f.value };
      this.facts.push({ ...saved, personId, captureId, active: true });
      return saved;
    });
  }
  async setCaptureStatus(id: string, status: CaptureStatus) {
    const c = this.captures.get(id);
    if (c && !(status === "failed" && c.status === "extracted")) c.status = status;
  }
}
