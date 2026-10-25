import { AMAZON_FIXTURES } from './fixtures.js'

// ─── SWAP POINT ──────────────────────────────────────────────────────────────
// Everything in this module is a best-effort, client-only lookup.
//
// Amazon serves a captcha interstitial to any automated page fetch, and serves
// it with HTTP 200 -- so a status check will not detect the block. The product
// PRICE therefore cannot be read from a URL alone without a paid scraping API.
//
// What does work with no server at all:
//   * the image, via the ASIN image CDN pattern in buildImageUrl()
//   * the name, de-slugified from the URL path when the URL carries a slug
//   * the name AND price, for the demo ASINs in ./fixtures.js
//
// To use a real scraping API later, replace the body of lookupAmazonProduct()
// with a fetch to your backend and map its response onto a LookupResult. Keep
// the signature and the return shape -- the UI depends on nothing else.
// ─────────────────────────────────────────────────────────────────────────────

const ASIN_RE = /^[A-Z0-9]{10}$/
const ASIN_IN_PATH_RE =
  /\/(?:dp|gp\/product|gp\/aw\/d|product|exec\/obidos\/asin)\/(?:product\/)?([A-Z0-9]{10})(?:\/|$)/i

const SHORT_LINK_HOST_RE = /^(a\.co|amzn\.to|amzn\.eu|amzn\.asia)$/i

// Second-level labels used by Amazon's multi-part marketplaces, as in amazon.co.uk.
const MARKETPLACE_SLDS = new Set(['co', 'com', 'net', 'org'])

// A regex can't do this safely: /amazon\.[a-z.]{2,}$/ happily accepts
// amazon.evil.com, because "evil.com" is shaped exactly like "co.uk". The
// registrable domain has to be checked label by label instead.
function isAmazonHost(hostname) {
  const labels = hostname.toLowerCase().split('.')
  if (labels.length < 2) return false
  // amazon.com, www.amazon.com, smile.amazon.com
  if (labels[labels.length - 2] === 'amazon') return true
  // amazon.co.uk, www.amazon.com.au
  return (
    labels.length >= 3 &&
    labels[labels.length - 3] === 'amazon' &&
    MARKETPLACE_SLDS.has(labels[labels.length - 2])
  )
}

const ERROR_MESSAGES = {
  EMPTY_INPUT: 'Paste an Amazon product link first.',
  INVALID_URL: "That doesn't look like a web address. Check the link and try again.",
  NOT_AMAZON: "That isn't an Amazon link -- fill the fields in below instead.",
  SHORT_LINK:
    "Short links like a.co and amzn.to can't be followed from the browser. Open the link in a new tab, then paste the full amazon.com/.../dp/... address.",
  NO_ASIN:
    "Couldn't find a product ID in that link. Open the product's own page and copy the URL from the address bar.",
  NETWORK_ERROR: 'That lookup failed. Check your connection and try again.',
}

// Path segments that are Amazon's URL scaffolding rather than the product name.
const STRUCTURAL_SEGMENTS = new Set([
  'dp', 'gp', 'product', 'aw', 'd', 'exec', 'obidos', 'asin',
  's', 'b', 'stores', 'ref', '-',
])

function normalizeUrl(raw) {
  // Copying a link out of a chat app often brings a newline or zero-width char.
  const cleaned = String(raw ?? '').replace(/[​-‍﻿]/g, '').trim()
  if (!cleaned) return { error: 'EMPTY_INPUT' }
  // new URL() throws without a scheme, and people paste "amazon.com/dp/...".
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`
  try {
    return { url: new URL(withScheme) }
  } catch {
    return { error: 'INVALID_URL' }
  }
}

export function extractAsin(pathname) {
  const match = pathname.match(ASIN_IN_PATH_RE)
  if (!match) return null
  // The `i` flag admits a lowercase ASIN, but the image CDN path is
  // case-sensitive -- .../P/b08n5wrwnw.01...jpg returns a placeholder.
  const asin = match[1].toUpperCase()
  return ASIN_RE.test(asin) ? asin : null
}

export function buildImageUrl(asin) {
  return `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`
}

export function deslugifyName(pathname, asin) {
  const candidates = pathname.split('/').filter(Boolean).filter((segment) => {
    const lower = segment.toLowerCase()
    if (STRUCTURAL_SEGMENTS.has(lower)) return false
    if (asin && lower === asin.toLowerCase()) return false
    if (/^ref=/i.test(segment)) return false
    if (/^[a-z]{2}(-[a-z]{2})?$/i.test(segment)) return false // locale, as in /-/en/dp/
    if (/^\d+$/.test(segment)) return false
    return true
  })

  // A real slug carries word separators; this rejects stray one-off tokens.
  const slug = candidates
    .filter((segment) => segment.length >= 4 && /[-_+]/.test(segment))
    .sort((a, b) => b.length - a.length)[0]
  if (!slug) return null

  let decoded
  try {
    decoded = decodeURIComponent(slug) // a lone '%' throws URIError
  } catch {
    decoded = slug
  }

  const words = decoded.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
  // Some slugs repeat the ASIN or trail a stray initial.
  while (words.length > 1) {
    const last = words[words.length - 1]
    if (last.toUpperCase() === asin || last.length === 1) words.pop()
    else break
  }

  // Capitalize only all-lowercase words, so USB, 4th and iPhone survive intact.
  let name = words
    .map((word) => (/[A-Z0-9]/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')

  if (name.length > 80) {
    const cut = name.slice(0, 80)
    const lastSpace = cut.lastIndexOf(' ')
    name = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()
  }

  return name || null
}

const LOOKUP_DELAY_MS = 200
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fail(code) {
  return {
    status: 'error',
    product: null,
    missing: [],
    error: { code, message: ERROR_MESSAGES[code] },
  }
}

/**
 * Resolves for every expected condition, including bad input; it rejects only on
 * a genuine fault (which is what the real API swap would introduce).
 *
 * @returns {Promise<{
 *   status: 'complete' | 'partial' | 'error',
 *   product: object | null,
 *   missing: string[],
 *   error: { code: string, message: string } | null,
 * }>}
 */
export async function lookupAmazonProduct(rawUrl) {
  const { url, error } = normalizeUrl(rawUrl)
  if (error) return fail(error)

  if (SHORT_LINK_HOST_RE.test(url.hostname)) return fail('SHORT_LINK')
  if (!isAmazonHost(url.hostname)) return fail('NOT_AMAZON')

  // Match against the path only, so #fragments and &query params can't confuse
  // the trailing boundary.
  const asin = extractAsin(url.pathname)
  if (!asin) return fail('NO_ASIN')

  // Stands in for a network round trip, so the pending state and the caller's
  // race guard are genuinely exercised. Replace at the swap point above.
  await sleep(LOOKUP_DELAY_MS)

  const fixture = AMAZON_FIXTURES[asin]
  const product = {
    name: fixture ? fixture.name : deslugifyName(url.pathname, asin),
    priceCents: fixture ? fixture.priceCents : null,
    imageUrl: buildImageUrl(asin),
    // Rebuilt canonically, which drops ref= tags, affiliate codes and session junk.
    productUrl: `https://${url.hostname}/dp/${asin}`,
    asin,
    source: fixture ? 'amazon-fixture' : 'amazon-url',
  }

  const missing = []
  if (!product.name) missing.push('name')
  if (product.priceCents === null) missing.push('priceCents')

  return {
    status: missing.length === 0 ? 'complete' : 'partial',
    product,
    missing,
    error: null,
  }
}
