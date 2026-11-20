// Choosing and cropping the product photo from the popup's screenshot. All of
// it happens on this device; nothing is sent until the user saves.

/** An image on the page, in CSS pixels, clipped to the viewport. */
export type PhotoBox = { src: string; x: number; y: number; width: number; height: number };

/** Source rectangle of the screenshot in device pixels, and the size to draw it at. */
export type CropRect = { x: number; y: number; width: number; height: number };
export type EncodeCrop = (
  source: Blob,
  crop: CropRect,
  out: { width: number; height: number },
  /** JPEG quality, 0..100. */
  quality: number,
) => Promise<Blob>;

/** host + path, so the same file served with a different query still matches. */
function pathKey(url: string): string | null {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return null;
  }
}

/** The box showing the product image first, then the rest by area, largest first. */
export function orderCandidates(boxes: PhotoBox[], productImageUrl: string | null): PhotoBox[] {
  const wanted = productImageUrl ? pathKey(productImageUrl) : null;
  const rank = (b: PhotoBox) => (wanted !== null && pathKey(b.src) === wanted ? 1 : 0);
  return [...boxes].sort((a, b) => rank(b) - rank(a) || b.width * b.height - a.width * a.height);
}

/**
 * Crops `box` out of the screenshot. `scale` is screenshot width ÷ viewport
 * width. The result is at most widthPx wide (never enlarged).
 */
export async function cropPhoto(
  screenshot: Blob,
  box: PhotoBox,
  scale: number,
  widthPx: number,
  quality: number,
  deps: { encode: EncodeCrop } = { encode: encodeCrop },
): Promise<Blob> {
  const crop = {
    x: Math.round(box.x * scale),
    y: Math.round(box.y * scale),
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
  };
  const outWidth = Math.min(widthPx, crop.width);
  const out = { width: outWidth, height: Math.max(1, Math.round((crop.height * outWidth) / crop.width)) };
  return deps.encode(screenshot, crop, out, quality);
}

async function encodeCrop(
  source: Blob,
  crop: CropRect,
  out: { width: number; height: number },
  quality: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(out.width, out.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas context");
    ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
  } finally {
    bitmap.close();
  }
}
