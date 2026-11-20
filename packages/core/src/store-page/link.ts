// Link cleaning and the match key (ALL-78). No dependencies, so it runs in the
// web app, the browser extension and tests alike. The SQL duplicate check
// (ALL-78 task 3) reproduces matchKey() exactly and is tested against the same
// fixture, match-key-cases.json.
//
// Match key format:
//   Amazon (any Amazon host, ASIN found in /dp/, /gp/product/, /gp/aw/d/,
//   /product/ or /exec/obidos/asin/, optionally followed by /product/):
//     amazon:<UPPER-CASE ASIN>
//   Everything else:
//     <host><path>[?<k>=<v>&<k>=<v>...]
//   - host: lower case, leading "www." then "m." removed
//   - path: as written (case kept), one trailing "/" removed; a bare "/" is empty
//   - params: only variant, sku, skuid, size, color, id, pid, productid, itemid
//     (matched case-insensitively); keys lower-cased, values kept as written
//     (not decoded); sorted by key, then value, in plain code-point order
//   - scheme, port, credentials, hash and all other params are ignored
//
// storeHost: the host as above; "amazon" for every Amazon host.

const TRACKING_PARAMS = new Set([
  "gclid", "fbclid", "msclkid", "mc_eid", "mc_cid", "_kx", "mkt_tok",
  "_hsenc", "_hsmi", "srsltid", "si", "spm", "ref_",
]);
const KEPT_PARAMS = new Set([
  "variant", "sku", "skuid", "size", "color", "id", "pid", "productid", "itemid",
]);
const MARKETPLACE_SLDS = new Set(["co", "com", "net", "org"]);
const ASIN_RE = /^[A-Z0-9]{10}$/;
const ASIN_IN_PATH =
  /\/(?:dp|gp\/product|gp\/aw\/d|product|exec\/obidos\/asin)\/(?:product\/)?([A-Z0-9]{10})(?:\/|$)/i;

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// Checked label by label: amazon.evil.com must not count as Amazon.
export function isAmazonHost(host: string): boolean {
  const labels = host.toLowerCase().split(".");
  if (labels.length < 2) return false;
  if (labels[labels.length - 2] === "amazon") return true;
  return (
    labels.length >= 3 &&
    labels[labels.length - 3] === "amazon" &&
    MARKETPLACE_SLDS.has(labels[labels.length - 2])
  );
}

// The ASIN in a product path, upper-cased (the image CDN is case-sensitive), or null.
export function extractAsin(pathname: string): string | null {
  const match = pathname.match(ASIN_IN_PATH);
  if (!match) return null;
  const asin = match[1].toUpperCase();
  return ASIN_RE.test(asin) ? asin : null;
}

function plainHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
}

export function cleanLink(url: string): string {
  const parsed = parse(url);
  if (!parsed) return url;
  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) parsed.searchParams.delete(key);
  }
  return parsed.href;
}

export function storeHost(url: string): string {
  const parsed = parse(url);
  if (!parsed) return "";
  const host = plainHost(parsed);
  return isAmazonHost(host) ? "amazon" : host;
}

export function matchKey(url: string): string {
  const parsed = parse(url);
  if (!parsed) return url;
  const host = plainHost(parsed);
  if (isAmazonHost(host)) {
    const asin = extractAsin(parsed.pathname);
    if (asin) return `amazon:${asin}`;
  }
  const path = parsed.pathname.replace(/\/$/, "");
  const pairs = parsed.search
    .slice(1)
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1
        ? [pair.toLowerCase(), ""]
        : [pair.slice(0, eq).toLowerCase(), pair.slice(eq + 1)];
    })
    .filter(([key]) => KEPT_PARAMS.has(key))
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
  return `${host}${path}${pairs.length ? `?${pairs.join("&")}` : ""}`;
}
