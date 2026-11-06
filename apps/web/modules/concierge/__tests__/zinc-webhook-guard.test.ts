// @vitest-environment node
// The webhook route's checks before it trusts a body (ALL-32): id shape and size cap.
import { describe, expect, it, vi } from "vitest";
import { readWebhookBody } from "../zinc/guard";

const ID = "5f0c3a52-7a43-4e55-9b0f-0d3a1d7c1a11";
const req = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://x.test/api/zinc/webhook/" + ID, { method: "POST", body, headers });

describe("readWebhookBody", () => {
  it("404 for a malformed id, without reading the cap", async () => {
    const maxBytes = vi.fn(async () => 100);
    expect(await readWebhookBody("nope", req("{}"), maxBytes)).toEqual({ ok: false, status: 404 });
    expect(maxBytes).not.toHaveBeenCalled();
  });

  it("413 when content-length is over the cap", async () => {
    const r = req("x", { "content-length": "101" });
    expect(await readWebhookBody(ID, r, async () => 100)).toEqual({ ok: false, status: 413 });
  });

  it("413 when there is no content-length and the stream goes over the cap", async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("a".repeat(60)));
        c.enqueue(new TextEncoder().encode("a".repeat(60)));
        c.close();
      },
    });
    const r = new Request("https://x.test/w", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(r.headers.get("content-length")).toBeNull();
    expect(await readWebhookBody(ID, r, async () => 100)).toEqual({ ok: false, status: 413 });
  });

  it("returns the body when within the cap", async () => {
    expect(await readWebhookBody(ID, req('{"a":1}'), async () => 100)).toEqual({ ok: true, body: '{"a":1}' });
  });
});
