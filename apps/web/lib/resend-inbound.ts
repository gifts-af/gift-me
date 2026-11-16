import { createHmac, timingSafeEqual } from "node:crypto";

// Resend's inbound side (ALL-31): verify the webhook (Svix signing) and fetch
// the received email and its attachments. Like lib/resend.ts, callers pass the
// key and fetch in. Unlike sendEmail, the fetchers throw a plain Error carrying
// the status; the caller logs it.

const RECEIVING_URL = "https://api.resend.com/emails/receiving";
const SVIX_TOLERANCE_SECONDS = 300; // Svix's documented replay window

export type Deps = { apiKey: string | undefined; fetch: typeof fetch };

export type ReceivedEmail = {
  from: string;
  subject: string;
  text: string;
  inReplyTo: string | null;
  headers: Record<string, string>;
  authentication: { spf: string; dkim: string; dmarc: string };
  attachments: { id: string; content_type: string; size: number }[];
};

export function verifySvix(raw: string, headers: Headers, secret: string, now: Date): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(now.getTime() / 1000 - seconds) > SVIX_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest();

  return signatures.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

function authHeaders(deps: Deps) {
  if (!deps.apiKey) throw new Error("RESEND_API_KEY is not set");
  return { Authorization: `Bearer ${deps.apiKey}` };
}

type ApiEmail = {
  from?: string;
  subject?: string;
  text?: string | null;
  headers?: Record<string, unknown> | null;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
  attachments?: { id: string; content_type: string; size: number }[] | null;
};

// "Name <a@b.com>" -> "a@b.com", lower-cased. The address is the LAST angle
// group: a display name can itself contain "<victim@x.com>", and taking the
// first group would let a sender impersonate someone else.
function bareAddress(from: string): string {
  const match = from.match(/<([^<>]*)>\s*$/);
  return (match ? match[1] : from).trim().toLowerCase();
}

export async function fetchReceivedEmail(id: string, deps: Deps): Promise<ReceivedEmail> {
  const res = await deps.fetch(`${RECEIVING_URL}/${encodeURIComponent(id)}`, { headers: authHeaders(deps) });
  if (!res.ok) throw new Error(`Resend responded ${res.status} fetching received email`);
  const body = (await res.json()) as ApiEmail;

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(body.headers ?? {})) {
    if (value === null || value === undefined) continue;
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }

  return {
    from: bareAddress(body.from ?? ""),
    subject: body.subject ?? "",
    text: body.text ?? "",
    inReplyTo: headers["in-reply-to"] ?? null,
    headers,
    authentication: {
      spf: body.authentication?.spf ?? "none",
      dkim: body.authentication?.dkim ?? "none",
      dmarc: body.authentication?.dmarc ?? "none",
    },
    attachments: (body.attachments ?? []).map((a) => ({
      id: a.id,
      content_type: a.content_type,
      size: a.size,
    })),
  };
}

export async function fetchAttachment(
  emailId: string,
  attId: string,
  deps: Deps,
  maxBytes?: number,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const headers = authHeaders(deps);
  const listRes = await deps.fetch(`${RECEIVING_URL}/${encodeURIComponent(emailId)}/attachments`, { headers });
  if (!listRes.ok) throw new Error(`Resend responded ${listRes.status} listing attachments`);
  const list = (await listRes.json()) as {
    has_more?: boolean;
    data?: { id: string; content_type: string; download_url: string }[];
  };
  const att = list.data?.find((a) => a.id === attId);
  if (!att) {
    // We only read the first page; say so rather than report a false "missing".
    if (list.has_more) throw new Error(`Attachment ${attId} not on first page of attachments`);
    throw new Error(`Attachment ${attId} not found on received email`);
  }

  // The download URL is a signed CDN link, so no bearer key goes to it.
  const fileRes = await deps.fetch(att.download_url);
  if (!fileRes.ok) throw new Error(`Attachment download responded ${fileRes.status}`);
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
    throw new Error(`Attachment ${attId} is ${bytes.byteLength} bytes, over the ${maxBytes} limit`);
  }
  return {
    bytes,
    contentType: fileRes.headers.get("content-type") ?? att.content_type,
  };
}
