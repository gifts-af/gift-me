// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/lib/turnstile";

// ALL-68: the server half of the bot check. Cloudflare says whether the
// browser's token is good. Anything short of a clear yes is a no (AC-3).

const yes = () => new Response(JSON.stringify({ success: true }), { status: 200 });
const no = () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 });

describe("verifyTurnstile", () => {
  it("is the field Cloudflare's widget adds to a form", () => {
    expect(TURNSTILE_FIELD).toBe("cf-turnstile-response");
  });

  it("asks Cloudflare with the secret and token, and passes a good token", async () => {
    const send = vi.fn(async () => yes());
    expect(await verifyTurnstile("tok-1", { secret: "sec-1", fetch: send })).toBe(true);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("secret")).toBe("sec-1");
    expect(body.get("response")).toBe("tok-1");
  });

  it("refuses a token Cloudflare rejects", async () => {
    expect(await verifyTurnstile("tok-1", { secret: "sec-1", fetch: async () => no() })).toBe(false);
  });

  it("refuses without asking when there's no token", async () => {
    const send = vi.fn(async () => yes());
    expect(await verifyTurnstile("", { secret: "sec-1", fetch: send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses when the secret isn't set", async () => {
    const send = vi.fn(async () => yes());
    expect(await verifyTurnstile("tok-1", { secret: undefined, fetch: send })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses when Cloudflare can't be reached or answers badly", async () => {
    const down = async () => {
      throw new Error("network down");
    };
    expect(await verifyTurnstile("tok-1", { secret: "sec-1", fetch: down })).toBe(false);
    expect(await verifyTurnstile("tok-1", { secret: "sec-1", fetch: async () => new Response("oops", { status: 500 }) })).toBe(false);
    expect(await verifyTurnstile("tok-1", { secret: "sec-1", fetch: async () => new Response("not json") })).toBe(false);
  });
});
