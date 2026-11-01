import type { CaptureStore, NewCaptureRow } from "../capture/store";

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
}
