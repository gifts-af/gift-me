import type { CaptureStore } from "./store";

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

// Log only the step and the error object: never the token, form body, text or screenshot.
function logFailure(step: string, err: unknown): void {
  console.error(`capture: ${step} failed`, err);
}

/**
 * Saves one capture: limits, size check, person check, insert, upload, set path.
 * If the upload or the path update fails the row is deleted again.
 */
export async function saveCapture(
  store: CaptureStore,
  input: CaptureInput,
): Promise<SaveResult> {
  let limits: Awaited<ReturnType<CaptureStore["limits"]>>;
  try {
    limits = await store.limits();
  } catch (err) {
    logFailure("limits", err);
    return { ok: false, status: 500, error: SAVE_FAILED };
  }

  if (input.screenshot.size > limits.screenshotMaxBytes) {
    return { ok: false, status: 413, error: "The screenshot is too large." };
  }

  try {
    if (!(await store.personExists(input.personId))) {
      return { ok: false, status: 404, error: "That person wasn't found." };
    }
  } catch (err) {
    logFailure("person check", err);
    return { ok: false, status: 500, error: SAVE_FAILED };
  }

  let created: { id: string; userId: string };
  try {
    created = await store.insertCapture({
      personId: input.personId,
      url: input.url,
      title: input.title,
      text: input.text.slice(0, limits.textMaxChars),
      note: input.note,
    });
  } catch (err) {
    logFailure("insert", err);
    return { ok: false, status: 500, error: SAVE_FAILED };
  }

  const path = `${created.userId}/${created.id}.jpg`;
  let step = "upload";
  try {
    await store.uploadScreenshot(path, input.screenshot);
    step = "set path";
    await store.setScreenshotPath(created.id, path);
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
