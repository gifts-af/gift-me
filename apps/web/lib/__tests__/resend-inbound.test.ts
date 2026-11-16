import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fetchAttachment, fetchReceivedEmail, verifySvix } from "@/lib/resend-inbound";

const SECRET = `whsec_${Buffer.from("test-signing-key-bytes").toString("base64")}`;
const NOW = new Date("2026-11-16T12:00:00Z");
const ts = Math.floor(NOW.getTime() / 1000);
const BODY = '{"type":"email.received","data":{"email_id":"e1"}}';

function sign(id: string, timestamp: number, body: string, secret = SECRET) {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

function svixHeaders(over: Record<string, string | null> = {}) {
  const h: Record<string, string | null> = {
    "svix-id": "msg_1",
    "svix-timestamp": String(ts),
    "svix-signature": sign("msg_1", ts, BODY),
    ...over,
  };
  const out = new Headers();
  for (const [k, v] of Object.entries(h)) if (v !== null) out.set(k, v);
  return out;
}

describe("verifySvix", () => {
  it("accepts a valid signature", () => {
    expect(verifySvix(BODY, svixHeaders(), SECRET, NOW)).toBe(true);
  });
  it("accepts when any of several signatures matches", () => {
    const sig = `v1,${Buffer.from("nope").toString("base64")} ${sign("msg_1", ts, BODY)}`;
    expect(verifySvix(BODY, svixHeaders({ "svix-signature": sig }), SECRET, NOW)).toBe(true);
  });
  it("rejects a changed body", () => {
    expect(verifySvix(`${BODY} `, svixHeaders(), SECRET, NOW)).toBe(false);
  });
  it("rejects a wrong secret", () => {
    const other = `whsec_${Buffer.from("other").toString("base64")}`;
    expect(verifySvix(BODY, svixHeaders(), other, NOW)).toBe(false);
  });
  it("rejects a missing header", () => {
    expect(verifySvix(BODY, svixHeaders({ "svix-signature": null }), SECRET, NOW)).toBe(false);
    expect(verifySvix(BODY, svixHeaders({ "svix-id": null }), SECRET, NOW)).toBe(false);
    expect(verifySvix(BODY, svixHeaders({ "svix-timestamp": null }), SECRET, NOW)).toBe(false);
  });
  it("rejects a timestamp 301 s off, either way, and accepts 300 s", () => {
    for (const off of [301, -301]) {
      const t = ts + off;
      const h = svixHeaders({ "svix-timestamp": String(t), "svix-signature": sign("msg_1", t, BODY) });
      expect(verifySvix(BODY, h, SECRET, NOW)).toBe(false);
    }
    const t = ts - 300;
    const h = svixHeaders({ "svix-timestamp": String(t), "svix-signature": sign("msg_1", t, BODY) });
    expect(verifySvix(BODY, h, SECRET, NOW)).toBe(true);
  });
  it("rejects a non-numeric timestamp", () => {
    expect(verifySvix(BODY, svixHeaders({ "svix-timestamp": "abc" }), SECRET, NOW)).toBe(false);
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchReceivedEmail", () => {
  const email = {
    id: "e1",
    from: "Ann Giver <Ann@Example.COM>",
    subject: "Idea",
    text: "a mug",
    headers: { "in-reply-to": "<abc@x>", "x-multi": ["a", "b"], "auto-submitted": "no" },
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    attachments: [{ id: "a1", filename: "f.png", content_type: "image/png", size: 12 }],
  };

  it("hits the receiving URL with the bearer key and maps fields", async () => {
    const f = vi.fn(async () => json(email));
    const out = await fetchReceivedEmail("e1", { apiKey: "k", fetch: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledWith("https://api.resend.com/emails/receiving/e1", {
      headers: { Authorization: "Bearer k" },
    });
    expect(out).toEqual({
      from: "ann@example.com",
      subject: "Idea",
      text: "a mug",
      inReplyTo: "<abc@x>",
      headers: { "in-reply-to": "<abc@x>", "x-multi": "a, b", "auto-submitted": "no" },
      authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
      attachments: [{ id: "a1", content_type: "image/png", size: 12 }],
    });
  });

  it("takes the last angle group, so a display name cannot impersonate", async () => {
    const f = vi.fn(async () =>
      json({ ...email, from: '"ann@victim.com <ann@victim.com>" <Evil@Attacker.com>' }),
    );
    const out = await fetchReceivedEmail("e1", { apiKey: "k", fetch: f as unknown as typeof fetch });
    expect(out.from).toBe("evil@attacker.com");
  });

  it("encodes the id in the path and coerces odd header values", async () => {
    const f = vi.fn(async (_url: string) => json({ ...email, headers: { A: 5, B: null } }));
    const out = await fetchReceivedEmail("a/b", { apiKey: "k", fetch: f as unknown as typeof fetch });
    expect(f.mock.calls[0][0]).toBe("https://api.resend.com/emails/receiving/a%2Fb");
    expect(out.headers).toEqual({ a: "5" });
  });

  it("handles a bare from, missing text/headers/attachments", async () => {
    const f = vi.fn(async () =>
      json({ id: "e1", from: "Bob@X.com", subject: "s", text: null, authentication: { spf: "none", dkim: "none", dmarc: "none" } }),
    );
    const out = await fetchReceivedEmail("e1", { apiKey: "k", fetch: f as unknown as typeof fetch });
    expect(out).toMatchObject({ from: "bob@x.com", text: "", inReplyTo: null, headers: {}, attachments: [] });
  });

  it("throws with the status on a non-ok response", async () => {
    const f = vi.fn(async () => json({}, 404));
    await expect(fetchReceivedEmail("e1", { apiKey: "k", fetch: f as unknown as typeof fetch })).rejects.toThrow("404");
  });
});

describe("fetchAttachment", () => {
  const list = { data: [{ id: "a1", content_type: "image/png", download_url: "https://cdn.resend.app/x" }] };

  it("looks up the download url, downloads, and returns bytes and type", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/attachments")
        ? json(list)
        : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
    );
    const out = await fetchAttachment("e1", "a1", { apiKey: "k", fetch: f as unknown as typeof fetch });
    expect(f).toHaveBeenNthCalledWith(1, "https://api.resend.com/emails/receiving/e1/attachments", {
      headers: { Authorization: "Bearer k" },
    });
    expect(f.mock.calls[1][0]).toBe("https://cdn.resend.app/x");
    expect(f.mock.calls[1]).toHaveLength(1); // no init, so no Authorization header to the CDN
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
    expect(out.contentType).toBe("image/png");
  });

  it("throws when the download is over maxBytes", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/attachments") ? json(list) : new Response(new Uint8Array([1, 2, 3])),
    );
    await expect(
      fetchAttachment("e1", "a1", { apiKey: "k", fetch: f as unknown as typeof fetch }, 2),
    ).rejects.toThrow("limit");
  });

  it("says so when the attachment may be on a later page", async () => {
    const f = vi.fn(async () => json({ has_more: true, data: [] }));
    await expect(fetchAttachment("e1", "a1", { apiKey: "k", fetch: f as unknown as typeof fetch })).rejects.toThrow(
      "first page",
    );
  });

  it("throws when the attachment is not listed", async () => {
    const f = vi.fn(async () => json({ data: [] }));
    await expect(fetchAttachment("e1", "a1", { apiKey: "k", fetch: f as unknown as typeof fetch })).rejects.toThrow("a1");
  });

  it("throws with the status when the download fails", async () => {
    const f = vi.fn(async (url: string) => (url.endsWith("/attachments") ? json(list) : new Response("x", { status: 403 })));
    await expect(fetchAttachment("e1", "a1", { apiKey: "k", fetch: f as unknown as typeof fetch })).rejects.toThrow("403");
  });
});
