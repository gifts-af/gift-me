// Reading the current tab. When the popup opens, readProductPage reads the
// product from a few slim page fragments; nothing from the page leaves the
// device until the user clicks Save (C-2).

import { readProductFromHtml, type PageProduct } from "@gifts-af/core/store-page";
import type { PhotoBox } from "./photo";

export type CollectedPage = { url: string; title: string; text: string; screenshot: Blob };

/** The screenshot stays over the server's size cap even after shrinking it. */
export class ScreenshotTooLargeError extends Error {
  constructor() {
    super("This page is too large to capture.");
    this.name = "ScreenshotTooLargeError";
  }
}

export type ScreenshotDeps = {
  /** Re-encodes `source` as a JPEG scaled by `scale` (0..1) on each side. */
  encode: (source: Blob, scale: number, quality: number) => Promise<Blob>;
};

const SHRINK_TRIES = 3;
// Aim a little under the cap, since JPEG size doesn't scale exactly with area.
const SHRINK_MARGIN = 0.9;

/**
 * Returns the screenshot as is when it fits under maxBytes, otherwise a
 * smaller re-encode of it. null when three shrinks still don't fit.
 */
export async function fitScreenshot(
  blob: Blob,
  maxBytes: number,
  quality: number,
  deps: ScreenshotDeps = { encode: encodeJpeg },
): Promise<Blob | null> {
  let current = blob;
  let scale = 1;
  for (let attempt = 0; current.size > maxBytes; attempt++) {
    if (attempt === SHRINK_TRIES) return null;
    // Size goes roughly with area, so scale each side by the square root.
    scale *= Math.sqrt(maxBytes / current.size) * SHRINK_MARGIN;
    current = await deps.encode(blob, scale, quality);
  }
  return current;
}

async function encodeJpeg(source: Blob, scale: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas context");
    ctx.drawImage(bitmap, 0, 0, width, height);
    // convertToBlob takes quality as 0..1; captureVisibleTab takes 0..100.
    return await canvas.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
  } finally {
    bitmap.close();
  }
}

export async function collectPage(
  tabId: number,
  opts: { jpegQuality: number; textMax: number; screenshotMaxBytes: number },
  deps?: ScreenshotDeps,
): Promise<CollectedPage> {
  // The func runs in the page, so it must stay self-contained.
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (max: number) => ({
      url: location.href,
      title: document.title,
      text: (document.body?.innerText ?? "").slice(0, max),
    }),
    args: [opts.textMax],
  });
  const page = injection.result as { url: string; title: string; text: string };
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: "jpeg", quality: opts.jpegQuality });
  const screenshot = await fitScreenshot(dataUrlToBlob(dataUrl), opts.screenshotMaxBytes, opts.jpegQuality, deps);
  if (!screenshot) throw new ScreenshotTooLargeError();
  return { ...page, screenshot };
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",", 2);
  const type = /^data:([^;]+)/.exec(header)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** What the popup learns from the page when it opens. */
export type ProductPage = {
  product: PageProduct;
  pageUrl: string;
  /** Lossless capture of the visible tab; the chosen photo is cropped from it. null when the capture failed. */
  screenshot: Blob | null;
  /** Screenshot pixel width ÷ viewportWidth: pass it straight to cropPhoto. null with no screenshot. */
  scale: number | null;
  /** Empty when there is no screenshot to crop from. */
  candidates: PhotoBox[];
  /** CSS pixels. */
  viewportWidth: number;
};

type MicroRecord = { prop: string; content: string | null; src: string | null; href: string | null; text: string };
type Fragments = {
  url: string;
  jsonLd: string[];
  microProps: MicroRecord[];
  itemTypes: string[];
  metas: { property: string | null; name: string | null; content: string | null }[];
  canonical: string | null;
  nextData: string | null;
  amazon: { title: string; price: string | null; image: string | null } | null;
  boxes: PhotoBox[];
  viewportWidth: number;
};

/**
 * Runs inside the page, so it must stay self-contained. Returns only what the
 * product reader looks at, plus the sizes and addresses of the page's images.
 */
function readFragments(): Fragments {
  const attr = (el: Element, name: string) => el.getAttribute(name);
  const host = location.hostname;
  const microNames = ["name", "price", "priceCurrency", "image", "sku", "gtin8", "gtin12", "gtin13", "gtin14", "mpn", "productID"];

  // The reader takes the first element for each prop, so one record each.
  const microProps: MicroRecord[] = [];
  for (const prop of microNames) {
    const el = document.querySelector(`[itemprop="${prop}"]`);
    if (el) {
      microProps.push({
        prop,
        content: attr(el, "content"),
        src: attr(el, "src"),
        href: attr(el, "href"),
        text: (el.textContent ?? "").slice(0, 300),
      });
    }
  }

  const metas = Array.from(document.querySelectorAll("meta"))
    .map((m) => ({ property: attr(m, "property"), name: attr(m, "name"), content: attr(m, "content") }))
    .filter((m) => /^(og|product):/i.test(m.property ?? m.name ?? ""));

  let amazon: Fragments["amazon"] = null;
  if (/(^|\.)amazon\./i.test(host)) {
    const block = document.querySelector("#corePrice_feature_div") ?? document.querySelector("#apex_desktop");
    amazon = {
      title: (document.querySelector("#productTitle")?.textContent ?? "").slice(0, 1000),
      price: block?.querySelector(".a-price .a-offscreen")?.textContent ?? null,
      image: document.querySelector("#landingImage")?.getAttribute("src") ?? null,
    };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const boxes: PhotoBox[] = [];
  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:")) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 120 || r.height < 120) continue;
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    const width = Math.min(viewportWidth, r.right) - left;
    const height = Math.min(viewportHeight, r.bottom) - top;
    if (width <= 0 || height <= 0 || width * height * 2 < r.width * r.height) continue;
    boxes.push({ src, x: left, y: top, width, height });
  }

  return {
    url: location.href,
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent ?? ""),
    microProps,
    itemTypes: Array.from(new Set(Array.from(document.querySelectorAll("[itemtype]")).map((e) => attr(e, "itemtype") ?? ""))),
    metas,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    nextData: /(^|\.)walmart\.com$/i.test(host) ? (document.querySelector("script#__NEXT_DATA__")?.textContent ?? null) : null,
    amazon,
    boxes,
    viewportWidth,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Script text is raw, so only a closing tag could end it early; "<\/" is the same in JSON.
const scriptText = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1");
const attrs = (pairs: [string, string | null][]) =>
  pairs.filter(([, v]) => v !== null).map(([k, v]) => ` ${k}="${escapeHtml(v as string)}"`).join("");

/** Rebuilds the fragments as a small page the shared reader reads like the real one. */
function fragmentsToHtml(f: Fragments): string {
  const head = [
    ...f.metas.map((m) => `<meta${attrs([["property", m.property], ["name", m.name], ["content", m.content]])}>`),
    f.canonical === null ? "" : `<link${attrs([["rel", "canonical"], ["href", f.canonical]])}>`,
    ...f.jsonLd.map((t) => `<script type="application/ld+json">${scriptText(t)}</script>`),
  ];
  const body = [
    ...f.itemTypes.map((t) => `<div${attrs([["itemtype", t]])}></div>`),
    ...f.microProps.map(
      (m) =>
        `<span${attrs([["itemprop", m.prop], ["content", m.content], ["src", m.src], ["href", m.href]])}>${escapeHtml(m.text)}</span>`,
    ),
    f.nextData === null ? "" : `<script id="__NEXT_DATA__" type="application/json">${scriptText(f.nextData)}</script>`,
    f.amazon
      ? `<span id="productTitle">${escapeHtml(f.amazon.title)}</span>` +
        (f.amazon.price === null
          ? ""
          : `<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">${escapeHtml(f.amazon.price)}</span></span></div>`) +
        (f.amazon.image === null ? "" : `<img id="landingImage"${attrs([["src", f.amazon.image]])}>`)
      : "",
  ];
  return `<html><head>${head.join("")}</head><body>${body.join("")}</body></html>`;
}

export type ReadDeps = { /** Pixel width of an image; defaults to createImageBitmap. */ imageWidth: (image: Blob) => Promise<number> };

async function decodeWidth(image: Blob): Promise<number> {
  const bitmap = await createImageBitmap(image);
  try {
    return bitmap.width;
  } finally {
    bitmap.close();
  }
}

/**
 * Reads the product from the open tab: one script for the fragments, one
 * screenshot. Throws when the tab can't be scripted (chrome://, Web Store) or
 * the script fails. A failed screenshot still returns the product, with
 * screenshot and scale null and no candidates.
 */
export async function readProductPage(tabId: number, deps: ReadDeps = { imageWidth: decodeWidth }): Promise<ProductPage> {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: readFragments });
  const fragments = injection?.result as Fragments | undefined;
  if (!fragments) throw new Error("The page script returned nothing");
  const product = readProductFromHtml(fragmentsToHtml(fragments), fragments.url);
  const base = { product, pageUrl: fragments.url, viewportWidth: fragments.viewportWidth };
  try {
    // PNG: no quality setting to choose; the crop is re-encoded at list_photo_jpeg_quality.
    const screenshot = dataUrlToBlob(await chrome.tabs.captureVisibleTab({ format: "png" }));
    const scale = (await deps.imageWidth(screenshot)) / fragments.viewportWidth;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("Unusable screenshot size");
    return { ...base, screenshot, scale, candidates: fragments.boxes };
  } catch {
    return { ...base, screenshot: null, scale: null, candidates: [] };
  }
}
