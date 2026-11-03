// Reads a product's name, price and photo out of a store page's HTML (ALL-10,
// planning decision 50). Pure: no network, no settings. The fetching and its
// safety checks are in ./store-page-fetch.ts.
//
// Sources, first one with a value wins for each field:
//   1. JSON-LD `Product` (most brand and Shopify sites, Banana Republic)
//   2. microdata (`itemprop="name|price|image"`)
//   3. Open Graph (`og:title`, `og:image`, `product:price:amount`)
//   4. Walmart's own page data, for the price only (Walmart has no standard
//      price tag in the HTML it serves)
// A page's <title> is never used: a captcha page has one too.

import { parse, type HTMLElement } from "node-html-parser";
import { MAX_PRICE_CENTS } from "./format.js";

export type PageProduct = {
  name: string | null;
  priceCents: number | null;
  imageUrl: string | null;
};

type Json = unknown;
type JsonObject = Record<string, Json>;

// Only US prices for now. A price with no currency is taken as USD.
const ACCEPTED_CURRENCY = "USD";

function isObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asList(value: Json): Json[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value: Json): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text || null;
}

/** "$1,024.50", "19.97" or 12 → cents; anything else → null. */
export function toCents(value: Json, currency: Json = null): number | null {
  if (currency !== null && currency !== undefined && currency !== "") {
    if (typeof currency !== "string" || currency.trim().toUpperCase() !== ACCEPTED_CURRENCY) return null;
  }
  let amount: number;
  if (typeof value === "number") amount = value;
  else if (typeof value === "string") {
    const digits = value.replace(/[$,\s]/g, "").replace(/^USD/i, "");
    if (!/^\d+(\.\d+)?$/.test(digits)) return null;
    amount = Number(digits);
  } else return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return cents > MAX_PRICE_CENTS ? null : cents;
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
    const cents =
      toCents(offer.price ?? null, currency) ??
      toCents(offer.lowPrice ?? null, currency) ??
      (isObject(offer.priceSpecification)
        ? toCents(offer.priceSpecification.price ?? null, offer.priceSpecification.priceCurrency ?? currency)
        : null);
    if (cents !== null) return cents;
  }
  return null;
}

function fromJsonLd(root: HTMLElement, pageUrl: string): PageProduct {
  const product = jsonLdNodes(root).find((node) => hasType(node, "Product") || hasType(node, "ProductGroup"));
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

function fromMicrodata(root: HTMLElement, pageUrl: string): PageProduct {
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

function fromOpenGraph(root: HTMLElement, pageUrl: string): PageProduct {
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

export function readProductFromHtml(html: string, pageUrl: string): PageProduct {
  const root = parse(html, { blockTextElements: { script: true, style: false } });
  const sources = [fromJsonLd(root, pageUrl), fromMicrodata(root, pageUrl), fromOpenGraph(root, pageUrl)];
  const pick = <K extends keyof PageProduct>(key: K) => sources.map((s) => s[key]).find((v) => v !== null) ?? null;
  return {
    name: pick("name"),
    priceCents: pick("priceCents") ?? walmartPrice(root, pageUrl),
    imageUrl: pick("imageUrl"),
  };
}
