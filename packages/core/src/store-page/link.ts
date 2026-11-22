// Link cleaning (ALL-78). No dependencies, so it runs in the web app, the
// browser extension and tests alike: cleanLink, productLink, extractAsin and
// isAmazonHost.
//
// The duplicate check's match key and store host are computed by the database
// only (lists.match_key and lists.store_host in
// supabase/migrations/20261121100000_extension_add.sql), as stored generated
// columns. This comment is their written rule; the examples in
// apps/web/modules/lists/__tests__/match-key-cases.json are checked against
// the SQL by add-item-db.test.ts. Change the rule, the SQL and the examples
// together.
//
// Match key format:
//   Amazon (any Amazon host, see isAmazonHost; ASIN found in /dp/,
//   /gp/product/, /gp/aw/d/, /product/ or /exec/obidos/asin/, optionally
//   followed by /product/, see extractAsin):
//     amazon:<UPPER-CASE ASIN>
//   Everything else:
//     <host><path>[?<k>=<v>&<k>=<v>...]
//   - host: lower case, leading "www." then "m." removed, each only when a dot
//     is still left after it (www.com and m.com stay as they are)
//   - path: as written (case kept), one trailing "/" removed; a bare "/" is empty
//   - params: only the KEPT_PARAMS below (variant, sku, skuid, size, color, id,
//     pid, productid, itemid), matched case-insensitively; keys lower-cased,
//     values kept as written (not decoded, so percent-encoding is compared
//     as-is); a bare key or an empty value both give "key="; repeated keys
//     are all kept
//   - params are sorted by key, then value, by code unit (COLLATE "C")
//   - scheme, port, credentials, hash and all other params are ignored
//   - not a URL at all: the key is the input unchanged, the host is ""
//
// Store host: the host as above; "amazon" for every Amazon host.
//
// Input is a link already serialized by WHATWG `new URL` (every stored
// product_url is).

const TRACKING_PARAMS = new Set([
  "gclid", "fbclid", "msclkid", "mc_eid", "mc_cid", "_kx", "mkt_tok",
  "_hsenc", "_hsmi", "srsltid", "si", "spm", "ref_",
]);
/** The match key's kept parameters: variants and query product ids. */
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

/**
 * The store a saved link points to, for "View on ...": "Amazon" for any Amazon
 * site, otherwise the bare domain ("walmart.com"). Null if it isn't a link.
 * Lives here, with no dependencies, so the concierge's emails can name a store
 * without loading the lists module's React components (ALL-29).
 */
export function storeName(productUrl: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(productUrl).hostname;
  } catch {
    return null;
  }
  return isAmazonHost(hostname) ? "Amazon" : hostname.replace(/^www\./i, "").toLowerCase();
}

// The ASIN in a product path, upper-cased (the image CDN is case-sensitive), or null.
export function extractAsin(pathname: string): string | null {
  const match = pathname.match(ASIN_IN_PATH);
  if (!match) return null;
  const asin = match[1].toUpperCase();
  return ASIN_RE.test(asin) ? asin : null;
}

function plainHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\.(?=[^.]+\.)/, "").replace(/^m\.(?=[^.]+\.)/, "");
}

export function cleanLink(url: string): string {
  const parsed = parse(url);
  if (!parsed) return url;
  parsed.hash = "";
  // Credentials in a link are never shared on a list.
  parsed.username = "";
  parsed.password = "";
  for (const key of [...parsed.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) parsed.searchParams.delete(key);
  }
  return parsed.href;
}



/**
 * The link saved for a product page (ALL-78): the page's canonical link when
 * there is one, else the page's own address, cleaned of tracking. A canonical
 * link often drops the variant (Shopify's has no ?variant=), so when it names
 * the same page (same host ignoring www./m., same path ignoring a trailing
 * slash) the page's kept parameters (variant, size, id, ...) are carried onto
 * it, replacing the canonical's own values for those keys. A canonical link
 * for another host or path is used as it is.
 */
export function productLink(pageUrl: string, canonicalUrl: string | null): string {
  if (!canonicalUrl) return cleanLink(pageUrl);
  const page = parse(pageUrl);
  const canonical = parse(canonicalUrl);
  if (!page || !canonical) return cleanLink(canonicalUrl);
  const path = (u: URL) => u.pathname.replace(/\/$/, "");
  if (plainHost(page) !== plainHost(canonical) || path(page) !== path(canonical)) return cleanLink(canonicalUrl);

  const kept = [...page.searchParams].filter(([key]) => KEPT_PARAMS.has(key.toLowerCase()));
  const keptKeys = new Set(kept.map(([key]) => key.toLowerCase()));
  for (const key of [...canonical.searchParams.keys()]) {
    if (keptKeys.has(key.toLowerCase())) canonical.searchParams.delete(key);
  }
  for (const [key, value] of kept) canonical.searchParams.append(key, value);
  return cleanLink(canonical.href);
}
