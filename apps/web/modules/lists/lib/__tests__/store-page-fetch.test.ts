import { describe, expect, it, vi } from "vitest";
import { fetchStorePage, lookupStorePage, type StorePageDeps } from "../store-page-fetch";

// Store sites aren't ours, so the network and DNS are faked (E5).

const PUBLIC_IP = "23.45.67.89";
const limits = { timeoutMs: 1000, maxBytes: 1000 };

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

function deps(over: Partial<StorePageDeps> = {}): StorePageDeps {
  return {
    fetch: vi.fn(async () => htmlResponse("<html>ok</html>")),
    resolve: vi.fn(async () => [PUBLIC_IP]),
    ...over,
  };
}

describe("fetchStorePage (ALL-10)", () => {
  it("returns the page's HTML for a public store link", async () => {
    const d = deps();
    const result = await fetchStorePage("https://www.walmart.com/ip/1", limits, d);
    expect(result).toEqual({ ok: true, html: "<html>ok</html>", finalUrl: "https://www.walmart.com/ip/1" });
    const [, init] = (d.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.redirect).toBe("manual");
    expect(init.headers["user-agent"]).toMatch(/Mozilla\/5\.0/);
  });

  it.each([
    ["the cloud metadata address", "169.254.169.254"],
    ["this machine", "127.0.0.1"],
    ["a home network", "192.168.1.10"],
    ["a private network", "10.0.0.5"],
    ["IPv6 loopback", "::1"],
    ["an IPv6 private network", "fd12:3456::1"],
    ["an IPv4 address wrapped in IPv6", "::ffff:127.0.0.1"],
    ["a wrapped IPv4 address in hex (loopback)", "::ffff:7f00:1"],
    ["a wrapped IPv4 address in hex (cloud metadata)", "::ffff:a9fe:a9fe"],
  ])("refuses a host that points at %s", async (_label, address) => {
    const d = deps({ resolve: vi.fn(async () => [PUBLIC_IP, address]) });
    const result = await fetchStorePage("https://sneaky.example.com/p/1", limits, d);
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("refuses a link written as a wrapped IPv6 address", async () => {
    const d = deps();
    for (const url of ["http://[::ffff:7f00:1]/", "http://[::ffff:a9fe:a9fe]/latest"]) {
      expect(await fetchStorePage(url, limits, d)).toEqual({ ok: false, reason: "blocked_address" });
    }
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("closes the body of every response it doesn't read", async () => {
    const bodies: Response[] = [
      new Response("moved", { status: 301, headers: { location: "/next" } }),
      new Response("nope", { status: 403, headers: { "content-type": "text/html" } }),
    ];
    const fetch = vi.fn().mockResolvedValueOnce(bodies[0]).mockResolvedValueOnce(bodies[1]);
    await fetchStorePage("https://shop.example.com/p", limits, deps({ fetch }));
    expect(bodies.every((r) => r.bodyUsed || r.body?.locked)).toBe(true);
  });

  it("refuses odd ports and non-web links before looking anything up", async () => {
    const d = deps();
    expect(await fetchStorePage("https://shop.example.com:8443/p", limits, d)).toEqual({ ok: false, reason: "bad_url" });
    expect(await fetchStorePage("ftp://shop.example.com/p", limits, d)).toEqual({ ok: false, reason: "bad_url" });
    expect(d.resolve).not.toHaveBeenCalled();
  });

  it("checks every redirect, and refuses one that leads inside", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://internal.example/" } }));
    const resolve = vi.fn(async (host: string) => (host === "internal.example" ? ["10.0.0.1"] : [PUBLIC_IP]));
    const result = await fetchStorePage("https://shop.example.com/p", limits, { fetch, resolve });
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("follows a normal redirect to the product page", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/ip/Rice/1" } }))
      .mockResolvedValueOnce(htmlResponse("<html>rice</html>"));
    const result = await fetchStorePage("https://www.walmart.com/ip/1", limits, deps({ fetch }));
    expect(result).toEqual({ ok: true, html: "<html>rice</html>", finalUrl: "https://www.walmart.com/ip/Rice/1" });
  });

  it("gives up after too many redirects", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "/again" } }));
    expect(await fetchStorePage("https://shop.example.com/p", limits, deps({ fetch }))).toEqual({
      ok: false,
      reason: "too_many_redirects",
    });
  });

  it("stops reading a page bigger than the limit", async () => {
    const fetch = vi.fn(async () => htmlResponse("x".repeat(5000)));
    expect(await fetchStorePage("https://shop.example.com/p", limits, deps({ fetch }))).toEqual({
      ok: false,
      reason: "too_big",
    });
  });

  it("only reads HTML, and only a 200", async () => {
    const image = vi.fn(async () => new Response("GIF", { headers: { "content-type": "image/gif" } }));
    expect(await fetchStorePage("https://shop.example.com/p", limits, deps({ fetch: image }))).toEqual({
      ok: false,
      reason: "not_html",
    });
    const blocked = vi.fn(async () => htmlResponse("denied", { status: 403 }));
    expect(await fetchStorePage("https://shop.example.com/p", limits, deps({ fetch: blocked }))).toEqual({
      ok: false,
      reason: "http_status",
    });
  });

  it("times out a slow store", async () => {
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    expect(await fetchStorePage("https://shop.example.com/p", { ...limits, timeoutMs: 20 }, deps({ fetch }))).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  it("reports a network failure without throwing", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchStorePage("https://shop.example.com/p", limits, deps({ fetch }))).toEqual({
      ok: false,
      reason: "network",
    });
    const resolve = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await fetchStorePage("https://nope.example.com/p", limits, deps({ resolve }))).toEqual({
      ok: false,
      reason: "network",
    });
  });
});


describe("lookupStorePage (ALL-10)", () => {
  const settings = { enabled: true, timeoutMs: 1000, maxBytes: 100_000 };
  const page = `<meta property="og:title" content="Blue Mug"><meta property="product:price:amount" content="12">`;

  it("reads the product and logs one event with ids and counts only", async () => {
    const log = vi.fn();
    const result = await lookupStorePage(
      { url: "https://shop.example.com/products/blue-mug?ref=me", userId: "u-1" },
      settings,
      { ...deps({ fetch: vi.fn(async () => htmlResponse(page)) }), log, now: () => 0 },
    );
    expect(result).toEqual({ ok: true, product: { name: "Blue Mug", priceCents: 1200, imageUrl: null } });
    expect(log).toHaveBeenCalledWith("store_page_read", {
      user_id: "u-1",
      store: "shop.example.com",
      outcome: "ok",
      found_name: true,
      found_price: true,
      found_image: false,
      ms: 0,
    });
    // Never the page path, query or product name (E6).
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/blue-mug|Blue Mug|ref=me/);
  });

  it("does nothing when switched off in app_settings", async () => {
    const d = { ...deps(), log: vi.fn(), now: () => 0 };
    const result = await lookupStorePage({ url: "https://shop.example.com/p", userId: "u-1" }, { ...settings, enabled: false }, d);
    expect(result).toEqual({ ok: false, reason: "off" });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("reports a page with nothing readable as not found", async () => {
    const d = { ...deps({ fetch: vi.fn(async () => htmlResponse("<title>Robot or human?</title>")) }), log: vi.fn(), now: () => 0 };
    const result = await lookupStorePage({ url: "https://www.walmart.com/ip/1", userId: "u-1" }, settings, d);
    expect(result).toEqual({ ok: false, reason: "nothing_found" });
    expect(d.log).toHaveBeenCalledWith("store_page_read", expect.objectContaining({ outcome: "nothing_found", store: "walmart.com" }));
  });
});
