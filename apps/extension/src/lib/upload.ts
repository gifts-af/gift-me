import { config } from "./config";

export type CaptureInput = {
  personId: string;
  url: string;
  title: string;
  text: string;
  note: string | null;
  screenshot: Blob;
};

export type UploadResult = { ok: true; id: string } | { ok: false; status: number; error: string };

const NETWORK_ERROR = "Couldn't reach GiftsAF. Check your connection.";
const FALLBACK_ERROR = "Couldn't save the capture. Try again.";

// POSTs one capture to the web app (apps/web/app/api/captures/route.ts).
export async function uploadCapture(accessToken: string, input: CaptureInput): Promise<UploadResult> {
  const form = new FormData();
  form.set("person_id", input.personId);
  form.set("url", input.url);
  form.set("title", input.title);
  form.set("text", input.text);
  if (input.note) form.set("note", input.note);
  form.set("screenshot", input.screenshot, "screenshot.jpg");

  let response: Response;
  try {
    response = await fetch(`${config.appOrigin}/api/captures`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }

  const body = (await response.json().catch(() => null)) as { id?: unknown; error?: unknown } | null;
  if (response.status === 201 && typeof body?.id === "string") return { ok: true, id: body.id };
  const error = typeof body?.error === "string" ? body.error : FALLBACK_ERROR;
  return { ok: false, status: response.status, error };
}
