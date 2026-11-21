// Amazon's product pages carry no JSON-LD or Open Graph price, so they are
// read from Amazon's own markup (owner decision, 2026-11-20, ALL-78). Only for
// Amazon hosts; anywhere else this returns null and the generic reader runs.
import { parse } from "node-html-parser";
import type { PageProduct } from "./read";
import { cleanText, toCents } from "./values";

const AMAZON_HOST = /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/i;
const ASIN_IN_PATH = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export function readAmazonProduct(html: string, pageUrl: string): PageProduct | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  if (!AMAZON_HOST.test(url.hostname)) return null;
  const asin = url.pathname.match(ASIN_IN_PATH)?.[1]?.toUpperCase();
  if (!asin) return null;

  const root = parse(html);
  const name = cleanText(root.querySelector("#productTitle")?.text);
  if (!name) return null;

  // Only the buy box: other prices on the page belong to other products.
  const priceBlock = root.querySelector("#corePrice_feature_div") ?? root.querySelector("#apex_desktop");
  const priceCents = toCents(priceBlock?.querySelector(".a-price .a-offscreen")?.text ?? null);

  let imageUrl: string | null = null;
  try {
    const src = root.querySelector("#landingImage")?.getAttribute("src");
    const image = src ? new URL(src.trim(), pageUrl) : null;
    imageUrl = image && (image.protocol === "https:" || image.protocol === "http:") ? image.href : null;
  } catch {
    // not a link
  }

  return { isProduct: true, name, priceCents, imageUrl, productId: asin, canonicalUrl: null };
}
