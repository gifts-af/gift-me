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

/** One gift for the signed-in user's own list (apps/web/app/api/lists/items/route.ts, ALL-78). */
export type AddInput = {
  name: string;
  priceCents: number;
  pageUrl: string;
  canonicalUrl: string | null;
  productId: string | null;
  /** The JPEG cropped from the screenshot; null when there's no photo. */
  photo: Blob | null;
  /** Add even though the server said a gift on the list looks like this one. */
  confirmLikely?: boolean;
};

export type LikelyGift = { name: string; priceCents: number; imageUrl: string | null };
export type AddOutcome =
  | { outcome: "added" }
  | { outcome: "duplicate" }
  | { outcome: "likely"; existing: LikelyGift }
  | { outcome: "full" };
export type AddResponse =
  | ({ ok: true } & AddOutcome)
  /** photoRefused: the server couldn't use the photo, so adding without it may work. */
  | { ok: false; status: number; error: string; photoRefused?: true };

const ADD_ERROR = "Couldn't add that gift. Try again.";
// 503 is the off switch (AC-20); 404 is a web app rolled back to before the route.
const ADD_PAUSED = "Adding from the extension is paused.";

function parseLikely(raw: unknown): LikelyGift | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, priceCents, imageUrl } = raw as Record<string, unknown>;
  if (typeof name !== "string" || typeof priceCents !== "number") return null;
  if (imageUrl !== null && typeof imageUrl !== "string") return null;
  return { name, priceCents, imageUrl };
}

export async function addToMyList(accessToken: string, input: AddInput): Promise<AddResponse> {
  const form = new FormData();
  form.set("v", "1");
  form.set("name", input.name);
  form.set("priceCents", String(input.priceCents));
  form.set("pageUrl", input.pageUrl);
  if (input.canonicalUrl) form.set("canonicalUrl", input.canonicalUrl);
  if (input.productId) form.set("productId", input.productId);
  if (input.confirmLikely) form.set("confirmLikely", "1");
  if (input.photo) form.set("photo", input.photo, "photo.jpg");

  const response = await post(`${config.appOrigin}/api/lists/items`, accessToken, form);
  if (!response) return { ok: false, status: 0, error: NETWORK_ERROR };
  if (response.status === 404 || response.status === 503) return { ok: false, status: response.status, error: ADD_PAUSED };

  const body = (await response.json().catch(() => null)) as {
    outcome?: unknown;
    existing?: unknown;
    error?: unknown;
    code?: unknown;
  } | null;
  if (response.status === 201 && body?.outcome === "added") return { ok: true, outcome: "added" };
  if (response.status === 200) {
    if (body?.outcome === "duplicate" || body?.outcome === "full") return { ok: true, outcome: body.outcome };
    const existing = body?.outcome === "likely" ? parseLikely(body.existing) : null;
    if (existing) return { ok: true, outcome: "likely", existing };
  }
  const error = typeof body?.error === "string" ? body.error : ADD_ERROR;
  if (response.status === 400 && body?.code === "photo") return { ok: false, status: 400, error, photoRefused: true };
  return { ok: false, status: response.status, error };
}
