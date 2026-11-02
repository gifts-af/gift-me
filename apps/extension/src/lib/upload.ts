import { FACT_CATEGORIES_EXTRACTED, type FactCategory } from "@gifts-af/core";
import { config } from "./config";

export type CaptureInput = {
  personId: string;
  url: string;
  title: string;
  text: string;
  note: string | null;
  screenshot: Blob;
};

/** What the web app learned from a capture (ALL-25; apps/web/modules/concierge/capture/extract.ts). */
export type Extraction = {
  status: "extracted" | "failed" | "pending";
  facts: { id: string; category: FactCategory; value: string }[];
};

/** `extraction` is null when an older server leaves it out or sends something unreadable. */
export type UploadResult =
  | { ok: true; id: string; extraction: Extraction | null }
  | { ok: false; status: number; error: string };
export type RetryResult = { ok: true; extraction: Extraction } | { ok: false; status: number; error: string };

const NETWORK_ERROR = "Couldn't reach GiftsAF. Check your connection.";
const FALLBACK_ERROR = "Couldn't save the capture. Try again.";
const RETRY_ERROR = "Couldn't read this page. Try again.";

const STATUSES = new Set(["extracted", "failed", "pending"]);
const CATEGORIES = new Set<string>(FACT_CATEGORIES_EXTRACTED);

function parseExtraction(raw: unknown): Extraction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { status, facts } = raw as { status?: unknown; facts?: unknown };
  if (typeof status !== "string" || !STATUSES.has(status) || !Array.isArray(facts)) return null;
  const ok = facts.every(
    (f) =>
      typeof f === "object" &&
      f !== null &&
      typeof f.id === "string" &&
      typeof f.value === "string" &&
      CATEGORIES.has(f.category),
  );
  return ok ? (raw as Extraction) : null;
}

async function post(url: string, accessToken: string, body?: FormData): Promise<Response | null> {
  try {
    return await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body });
  } catch {
    return null;
  }
}

// POSTs one capture to the web app (apps/web/app/api/captures/route.ts).
export async function uploadCapture(accessToken: string, input: CaptureInput): Promise<UploadResult> {
  const form = new FormData();
  form.set("person_id", input.personId);
  form.set("url", input.url);
  form.set("title", input.title);
  form.set("text", input.text);
  if (input.note) form.set("note", input.note);
  form.set("screenshot", input.screenshot, "screenshot.jpg");

  const response = await post(`${config.appOrigin}/api/captures`, accessToken, form);
  if (!response) return { ok: false, status: 0, error: NETWORK_ERROR };

  const body = (await response.json().catch(() => null)) as { id?: unknown; error?: unknown; extraction?: unknown } | null;
  if (response.status === 201 && typeof body?.id === "string") {
    return { ok: true, id: body.id, extraction: parseExtraction(body.extraction) };
  }
  const error = typeof body?.error === "string" ? body.error : FALLBACK_ERROR;
  return { ok: false, status: response.status, error };
}

// Reads a saved capture again (apps/web/app/api/captures/[id]/extract/route.ts).
export async function retryExtraction(accessToken: string, captureId: string): Promise<RetryResult> {
  const response = await post(`${config.appOrigin}/api/captures/${encodeURIComponent(captureId)}/extract`, accessToken);
  if (!response) return { ok: false, status: 0, error: NETWORK_ERROR };

  const body = (await response.json().catch(() => null)) as { error?: unknown; extraction?: unknown } | null;
  const extraction = parseExtraction(body?.extraction);
  if (response.status === 200 && extraction) return { ok: true, extraction };
  const error = typeof body?.error === "string" ? body.error : RETRY_ERROR;
  return { ok: false, status: response.status, error };
}
