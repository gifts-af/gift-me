import type { CaptureStore, NewCaptureRow } from "./store";
import { errorFields, logEvent } from "@/lib/log";

export type CaptureInput = {
  personId: string;
  url: string;
  title: string;
  text: string;
  note: string | null;
  screenshot: Blob;
};

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; status: 404 | 413 | 500; error: string };

const SAVE_FAILED = "Couldn't save the capture.";

/** Matches the check constraint on concierge.captures.note. */
export const CAPTURE_NOTE_MAX_CHARS = 2000;

// Log only the step and the error's code: never the token, form body, text or screenshot.
function logFailure(step: string, err: unknown): void {
  logEvent("capture.failed", { step, ...errorFields(err) });
}

/** An emailed note (ALL-31): no page, and at most one image of any of these types. */
export type NoteCaptureInput = {
  personId: string;
  title: string;
  text: string;
  image: { bytes: Uint8Array; type: string } | null;
};

/** File extension for each image type a capture can hold. */
export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

type Image = { blob: Blob; type: string; ext: string };

/** Saves one capture from the browser extension; its screenshot is always a JPEG. */
export function saveCapture(store: CaptureStore, input: CaptureInput): Promise<SaveResult> {
  return persist(
    store,
    { personId: input.personId, url: input.url, title: input.title, text: input.text, note: input.note },
    { blob: input.screenshot, type: "image/jpeg", ext: "jpg" },
  );
}

/** Saves an emailed note for one person, with its image if it had one. */
export async function saveNoteCapture(store: CaptureStore, input: NoteCaptureInput): Promise<SaveResult> {
  let image: Image | null = null;
  if (input.image) {
    const ext = IMAGE_EXTENSIONS[input.image.type];
    if (!ext) {
      // The type is a MIME string, never personal data.
      // The type is the sender's own text, so it stays out of the log.
      logFailure("image type", null);
      return { ok: false, status: 500, error: SAVE_FAILED };
    }
    image = { blob: new Blob([input.image.bytes as BlobPart], { type: input.image.type }), type: input.image.type, ext };
  }
  return persist(
    store,
    { personId: input.personId, url: null, title: input.title, text: input.text, note: null },
    image,
  );
}

/**
 * Limits, size check, person check, insert, then upload and set path when there's an image.
 * If the upload or the path update fails the row is deleted again.
 */
async function persist(store: CaptureStore, row: NewCaptureRow, image: Image | null): Promise<SaveResult> {
  let limits: Awaited<ReturnType<CaptureStore["limits"]>>;
  try {
    limits = await store.limits();
  } catch (err) {
    logFailure("limits", err);
    return { ok: false, status: 500, error: SAVE_FAILED };
  }

  if (image && image.blob.size > limits.screenshotMaxBytes) {
    return { ok: false, status: 413, error: "The screenshot is too large." };
  }

  try {
    if (!(await store.personExists(row.personId))) {
      return { ok: false, status: 404, error: "That person wasn't found." };
    }
  } catch (err) {
    logFailure("person check", err);
    return { ok: false, status: 500, error: SAVE_FAILED };
  }

  let created: { id: string; userId: string };
  try {
    created = await store.insertCapture({ ...row, text: row.text.slice(0, limits.textMaxChars) });
  } catch (err) {
    logFailure("insert", err);
    return { ok: false, status: 500, error: SAVE_FAILED };
  }

  if (!image) return { ok: true, id: created.id };

  const path = `${created.userId}/${created.id}.${image.ext}`;
  let step = "upload";
  try {
    await store.uploadScreenshot(path, image.blob, image.type);
    step = "set path";
    await store.setScreenshotPath(created.id, path, image.type);
  } catch (err) {
    logFailure(step, err);
    try {
      await store.deleteCapture(created.id);
    } catch (deleteErr) {
      // Best effort; the original failure is what we report.
      logFailure("rollback delete", deleteErr);
    }
    return { ok: false, status: 500, error: SAVE_FAILED };
  }

  return { ok: true, id: created.id };
}

/** Reads the extension's multipart body. null means a bad request (400). */
export function parseCaptureForm(form: FormData): CaptureInput | null {
  const personId = form.get("person_id");
  const screenshot = form.get("screenshot");
  if (typeof personId !== "string" || personId === "") return null;
  if (typeof screenshot === "string" || screenshot === null) return null;
  if (screenshot.size === 0) return null;
  if (screenshot.type !== "" && screenshot.type !== "image/jpeg") return null;

  const str = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" ? v : "";
  };
  const note = str("note").trim();
  if (note.length > CAPTURE_NOTE_MAX_CHARS) return null;

  return {
    personId,
    url: str("url"),
    title: str("title"),
    text: str("text"),
    note: note === "" ? null : note,
    screenshot,
  };
}
