export type NewCaptureRow = {
  personId: string;
  url: string;
  title: string;
  text: string;
  note: string | null;
};

/** Persistence for captures; Task 3 supplies the Supabase-backed version. */
export interface CaptureStore {
  limits(): Promise<{ textMaxChars: number; screenshotMaxBytes: number }>;
  /** RLS-scoped: false for a person that belongs to someone else. */
  personExists(personId: string): Promise<boolean>;
  insertCapture(row: NewCaptureRow): Promise<{ id: string; userId: string }>;
  /** Throws on failure. */
  uploadScreenshot(path: string, jpeg: Blob): Promise<void>;
  setScreenshotPath(id: string, path: string): Promise<void>;
  deleteCapture(id: string): Promise<void>;
}
