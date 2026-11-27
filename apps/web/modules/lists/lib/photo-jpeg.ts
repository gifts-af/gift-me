import sharp from "sharp";

// A downloaded store photo turned into our own stored copy: at most widthPx
// wide (never enlarged), JPEG at the given quality, the same shape as the
// extension's photos (list_photo_* settings). Tiny images are refused: a
// 1x1 placeholder (what Amazon serves for many guessed photo links) is not
// a photo.

export type JpegOptions = { widthPx: number; quality: number; minPx: number; maxBytes: number };

export type JpegResult = { ok: true; jpeg: Buffer } | { ok: false; reason: "bad_image" | "tiny_image" | "too_big" };

// A decompression bomb (a small file that unpacks to a huge image) is refused before decoding.
const MAX_INPUT_PIXELS = 25_000_000;

export async function toListPhotoJpeg(bytes: Buffer, opts: JpegOptions): Promise<JpegResult> {
  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata());
  } catch {
    return { ok: false, reason: "bad_image" };
  }
  if (!width || !height) return { ok: false, reason: "bad_image" };
  if (width < opts.minPx || height < opts.minPx) return { ok: false, reason: "tiny_image" };

  let jpeg: Buffer;
  try {
    jpeg = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: opts.widthPx, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: opts.quality })
      .toBuffer();
  } catch {
    return { ok: false, reason: "bad_image" };
  }
  if (jpeg.length > opts.maxBytes) return { ok: false, reason: "too_big" };
  return { ok: true, jpeg };
}
