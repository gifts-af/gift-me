// Fetches a store's product page from our server and reads it (ALL-10,
// planning decision 50, design decision T52). Everything it uses arrives as an
// argument (E3): the server action passes the real fetch, DNS lookup, settings
// and logger.
//
// The link comes from a person, so the fetch must never reach anything but the
// public internet (no "server-side request forgery"): web links on the
// normal ports only, every address the host resolves to must be public, and
// every redirect is checked again. Remaining gap [Claude's call]: fetch looks
// the host up once more when it connects, so a host that changes its answer
// between the two lookups could slip through. Vercel functions sit on no
// private network of ours, so there is nothing inside to reach.

import { BlockList, isIP } from "node:net";
import { readProductFromHtml, type PageProduct } from "./store-page";

export type StorePageDeps = {
  fetch: (url: string, init: RequestInit & { headers: Record<string, string> }) => Promise<Response>;
  /** Every IP address a host name resolves to. */
  resolve: (hostname: string) => Promise<string[]>;
};

export type StorePageLimits = { timeoutMs: number; maxBytes: number };

export type FetchFailure =
  | "bad_url"
  | "blocked_address"
  | "too_many_redirects"
  | "http_status"
  | "not_html"
  | "too_big"
  | "timeout"
  | "network";

export type FetchResult = { ok: true; html: string; finalUrl: string } | { ok: false; reason: FetchFailure };

// How many redirects a product link may take. Stores redirect once or twice
// (an ID-only link to its full name); more than this is a loop.
const MAX_REDIRECTS = 5;

// The same request a normal Chrome browser sends. Store bot checks answer a
// plain script request with a captcha page (2026-11-03 tests in ALL-89).
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1",
};

// Addresses that aren't the public internet: this machine, private and
// carrier networks, link-local (cloud metadata lives at 169.254.169.254),
// documentation, multicast and reserved ranges.
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32], ["64:ff9b::", 96],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(address);
  if (family === 0) return false;
  return !NOT_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

function checkUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  if (url.username || url.password) return null;
  return url;
}

async function hostIsPublic(url: URL, resolve: StorePageDeps["resolve"]): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host);
  return addresses.length > 0 && addresses.every(isPublicAddress);
}

// A body that's never read keeps its connection open until garbage collection.
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // already closed
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response);
    return null;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchStorePage(rawUrl: string, limits: StorePageLimits, deps: StorePageDeps): Promise<FetchResult> {
  const start = checkUrl(rawUrl);
  if (!start) return { ok: false, reason: "bad_url" };
  let url: URL = start;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await hostIsPublic(url, deps.resolve))) return { ok: false, reason: "blocked_address" };

      const response = await deps.fetch(url.href, {
        headers: BROWSER_HEADERS,
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        const next: URL | null = location ? checkUrl(new URL(location, url).href) : null;
        await discard(response);
        if (!next) return { ok: false, reason: "bad_url" };
        url = next;
        continue;
      }
      if (response.status !== 200) {
        await discard(response);
        return { ok: false, reason: "http_status" };
      }
      if (!/^\s*(text\/html|application\/xhtml\+xml)/i.test(response.headers.get("content-type") ?? "")) {
        await discard(response);
        return { ok: false, reason: "not_html" };
      }
      const html = await readCapped(response, limits.maxBytes);
      if (html === null) return { ok: false, reason: "too_big" };
      return { ok: true, html, finalUrl: url.href };
    }
    return { ok: false, reason: "too_many_redirects" };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export type StorePageSettings = StorePageLimits & { enabled: boolean };

export type LookupStorePageResult =
  | { ok: true; product: PageProduct }
  | { ok: false; reason: FetchFailure | "off" | "nothing_found" };

type Logger = (event: string, fields: Record<string, string | number | boolean | null>) => void;

/** Fetches and reads one store link, and logs one event (E6: ids and counts only). */
export async function lookupStorePage(
  input: { url: string; userId: string },
  settings: StorePageSettings,
  deps: StorePageDeps & { log: Logger; now: () => number },
): Promise<LookupStorePageResult> {
  if (!settings.enabled) return { ok: false, reason: "off" };

  const started = deps.now();
  let store: string | null = null;
  try {
    store = new URL(input.url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    // reported as bad_url by the fetch below
  }

  const page = await fetchStorePage(input.url, settings, deps);
  let result: LookupStorePageResult;
  if (!page.ok) {
    result = page;
  } else {
    const product = readProductFromHtml(page.html, page.finalUrl);
    const found = product.name !== null || product.priceCents !== null || product.imageUrl !== null;
    result = found ? { ok: true, product } : { ok: false, reason: "nothing_found" };
  }

  const product = result.ok ? result.product : null;
  deps.log("store_page_read", {
    user_id: input.userId,
    store,
    outcome: result.ok ? "ok" : result.reason,
    found_name: product?.name != null,
    found_price: product?.priceCents != null,
    found_image: product?.imageUrl != null,
    ms: deps.now() - started,
  });
  return result;
}
