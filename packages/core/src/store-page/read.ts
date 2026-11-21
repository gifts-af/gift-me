// Reads a product's name, price, photo and ID out of a store page's HTML
// (ALL-10, planning decision 50; shared with the extension in ALL-78). Pure:
// no network, no settings. The website's fetching and its safety checks are in
// apps/web/modules/lists/lib/store-page-fetch.ts.
//
// Sources, first one with a value wins for each field:
//   1. JSON-LD `Product` (most brand and Shopify sites, Banana Republic)
//   2. microdata (`itemprop="name|price|image"`)
//   3. Open Graph (`og:title`, `og:image`, `product:price:amount`)
//   4. Walmart's own page data, for the price only (Walmart has no standard
//      price tag in the HTML it serves)
// Amazon pages are read by ./amazon.ts first, since they carry none of these.
// A page's <title> is never used: a captcha page has one too.
//
// `isProduct` is true only with a product signal (JSON-LD Product or
// ProductGroup, microdata Product, og:type product, a product:price:* tag).
// Open Graph tags alone (Instagram, blogs) are not a product.

import { parse, type HTMLElement } from "node-html-parser";
import { readAmazonProduct } from "./amazon";
import { cleanText, toCents } from "./values";

export type PageProduct = {
  isProduct: boolean;
  name: string | null;
  priceCents: number | null;
  imageUrl: string | null;
  productId: string | null;
  canonicalUrl: string | null;
};

// What each source (JSON-LD, microdata, Open Graph) can tell us.
type Fields = Pick<PageProduct, "name" | "priceCents" | "imageUrl">;

export { toCents };

type Json = unknown;
type JsonObject = Record<string, Json>;

function isObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asList(value: Json): Json[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// Product ID fields, most specific first (the first one present wins).
const ID_FIELDS = ["sku", "gtin8", "gtin12", "gtin13", "gtin14", "mpn", "productID"];

function idText(value: Json): string | null {
  return typeof value === "number" ? String(value) : cleanText(value);
}

/** An absolute http(s) link, resolved against the page; anything else → null. */
function toImageUrl(value: Json, pageUrl: string): string | null {
  const raw = isObject(value) ? value.url ?? value.contentUrl : value;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim(), pageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function hasType(node: JsonObject, type: string): boolean {
  return asList(node["@type"]).some((t) => typeof t === "string" && t.toLowerCase() === type.toLowerCase());
}

/** Every object in the JSON-LD blocks, including inside @graph. */
function jsonLdNodes(root: HTMLElement): JsonObject[] {
  const nodes: JsonObject[] = [];
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let data: Json;
    try {
      data = JSON.parse(script.rawText);
    } catch {
      continue; // one broken block shouldn't hide the others
    }
    for (const item of asList(data)) {
      if (!isObject(item)) continue;
      nodes.push(item);
      for (const inner of asList(item["@graph"])) if (isObject(inner)) nodes.push(inner);
    }
  }
  return nodes;
}

function priceFromOffers(offers: Json): number | null {
  for (const offer of asList(offers)) {
    if (!isObject(offer)) continue;
    const currency = offer.priceCurrency ?? null;
    // A range (lowPrice differs from highPrice) has no single price to take.
    const low = toCents(offer.lowPrice ?? null, currency);
    const high = toCents(offer.highPrice ?? null, currency);
    const flatLow = low !== null && (offer.highPrice == null || low === high) ? low : null;
    const cents =
      toCents(offer.price ?? null, currency) ??
      flatLow ??
      (isObject(offer.priceSpecification)
        ? toCents(offer.priceSpecification.price ?? null, offer.priceSpecification.priceCurrency ?? currency)
        : null);
    if (cents !== null) return cents;
  }
  return null;
}

function jsonLdProduct(root: HTMLElement): JsonObject | undefined {
  return jsonLdNodes(root).find((node) => hasType(node, "Product") || hasType(node, "ProductGroup"));
}

function fromJsonLd(product: JsonObject | undefined, pageUrl: string): Fields {
  if (!product) return { name: null, priceCents: null, imageUrl: null };
  let priceCents = priceFromOffers(product.offers);
  if (priceCents === null) {
    // A ProductGroup keeps its offers on the variants.
    for (const variant of asList(product.hasVariant)) {
      if (isObject(variant) && (priceCents = priceFromOffers(variant.offers)) !== null) break;
    }
  }
  return {
    name: cleanText(product.name),
    priceCents,
    imageUrl: asList(product.image).map((image) => toImageUrl(image, pageUrl)).find(Boolean) ?? null,
  };
}

function itemprop(root: HTMLElement, prop: string): HTMLElement | null {
  return root.querySelector(`[itemprop="${prop}"]`);
}

function fromMicrodata(root: HTMLElement, pageUrl: string): Fields {
  const name = itemprop(root, "name");
  const price = itemprop(root, "price");
  const currency = itemprop(root, "priceCurrency");
  const image = itemprop(root, "image");
  return {
    name: name ? cleanText(name.getAttribute("content") ?? name.text) : null,
    priceCents: price
      ? toCents(price.getAttribute("content") ?? price.text, currency ? currency.getAttribute("content") ?? currency.text : null)
      : null,
    imageUrl: image
      ? toImageUrl(image.getAttribute("content") ?? image.getAttribute("src") ?? image.getAttribute("href") ?? null, pageUrl)
      : null,
  };
}

function meta(root: HTMLElement, property: string): string | null {
  const tag = root.querySelector(`meta[property="${property}"]`) ?? root.querySelector(`meta[name="${property}"]`);
  return tag ? cleanText(tag.getAttribute("content") ?? null) : null;
}

/** Drops a trailing " - Walmart.com" or " | Shop Co" that names the site. */
function withoutSiteName(title: string, siteName: string | null, pageUrl: string): string {
  const match = title.match(/^(.*\S)\s+[-|–—]\s+([^-|–—]+)$/);
  if (!match) return title;
  const suffix = match[2].toLowerCase();
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const brand = host.split(".").slice(-2)[0];
  const namesSite = (siteName && suffix.includes(siteName.toLowerCase())) || suffix.includes(brand);
  return namesSite ? match[1] : title;
}

function fromOpenGraph(root: HTMLElement, pageUrl: string): Fields {
  const title = meta(root, "og:title");
  return {
    name: title ? withoutSiteName(title, meta(root, "og:site_name"), pageUrl) : null,
    priceCents: toCents(
      meta(root, "product:price:amount") ?? meta(root, "og:price:amount"),
      meta(root, "product:price:currency") ?? meta(root, "og:price:currency"),
    ),
    imageUrl: toImageUrl(meta(root, "og:image:secure_url") ?? meta(root, "og:image"), pageUrl),
  };
}

/** Walmart: props.pageProps.initialData.data.product.priceInfo.currentPrice. */
function walmartPrice(root: HTMLElement, pageUrl: string): number | null {
  if (!/(^|\.)walmart\.com$/i.test(new URL(pageUrl).hostname)) return null;
  const script = root.querySelector("script#__NEXT_DATA__");
  if (!script) return null;
  try {
    const data = JSON.parse(script.rawText);
    const current = data?.props?.pageProps?.initialData?.data?.product?.priceInfo?.currentPrice;
    return isObject(current) ? toCents(current.price ?? null, current.currencyUnit ?? null) : null;
  } catch {
    return null;
  }
}

function microdataIsProduct(root: HTMLElement): boolean {
  return root.querySelectorAll("[itemtype]").some((el) => /\/Product$/i.test(el.getAttribute("itemtype")?.trim() ?? ""));
}

function metaHasProductPrice(root: HTMLElement): boolean {
  return root
    .querySelectorAll("meta")
    .some((tag) => /^product:price:/i.test(tag.getAttribute("property") ?? tag.getAttribute("name") ?? ""));
}

// "product" and Open Graph's "product.item" / "product.group" kinds.
function ogTypeIsProduct(root: HTMLElement): boolean {
  return /^product(\.|$)/i.test(meta(root, "og:type") ?? "");
}

function jsonLdId(product: JsonObject | undefined): string | null {
  if (!product) return null;
  for (const field of ID_FIELDS) {
    const id = idText(product[field]);
    if (id) return id;
  }
  return null;
}

function microdataId(root: HTMLElement): string | null {
  for (const field of ID_FIELDS) {
    const el = itemprop(root, field);
    const id = el ? cleanText(el.getAttribute("content") ?? el.text) : null;
    if (id) return id;
  }
  return null;
}

const withoutWww = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** The page's own address, from canonical, og:url or JSON-LD url: the first on the page's own site. */
function canonicalUrl(root: HTMLElement, product: JsonObject | undefined, pageUrl: string): string | null {
  const candidates = [
    root.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    meta(root, "og:url"),
    typeof product?.url === "string" ? product.url : null,
  ];
  const pageHost = withoutWww(new URL(pageUrl).hostname);
  for (const raw of candidates) {
    if (!raw?.trim()) continue;
    try {
      const url = new URL(raw.trim(), pageUrl);
      if ((url.protocol === "https:" || url.protocol === "http:") && withoutWww(url.hostname) === pageHost) return url.href;
    } catch {
      // not a link
    }
  }
  return null;
}

export function readProductFromHtml(html: string, pageUrl: string): PageProduct {
  const amazon = readAmazonProduct(html, pageUrl);
  if (amazon) return amazon;

  const root = parse(html, { blockTextElements: { script: true, style: false } });
  const product = jsonLdProduct(root);
  const sources = [fromJsonLd(product, pageUrl), fromMicrodata(root, pageUrl), fromOpenGraph(root, pageUrl)];
  const pick = <K extends keyof Fields>(key: K) => sources.map((s) => s[key]).find((v) => v !== null) ?? null;
  return {
    isProduct: Boolean(product) || microdataIsProduct(root) || ogTypeIsProduct(root) || metaHasProductPrice(root),
    name: pick("name"),
    priceCents: pick("priceCents") ?? walmartPrice(root, pageUrl),
    imageUrl: pick("imageUrl"),
    productId: jsonLdId(product) ?? microdataId(root),
    canonicalUrl: canonicalUrl(root, product, pageUrl),
  };
}
