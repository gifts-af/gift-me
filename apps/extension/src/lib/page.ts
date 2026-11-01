// Reading the current tab. Only canCapture runs when the popup opens; the page
// itself is read only when the user clicks Save (C-2).

export type CollectedPage = { url: string; title: string; text: string; screenshot: Blob };

/** Chrome refuses scripts on chrome://, the Web Store and similar pages. */
export async function canCapture(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: () => true });
    return true;
  } catch {
    return false;
  }
}

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
