import { productLink } from "@gifts-af/core/store-page/link";
import { z } from "zod";
import { logEvent } from "@/lib/log";
import { MAX_PRICE_CENTS } from "./format";
import { cleanUrl, MAX_NAME_LENGTH } from "./save-list";

// "Add to my list" from the Chrome extension (ALL-78): the form the extension
// posts to POST /api/lists/items, and the add itself. The route makes the
// store and the item id and reads the settings; this file never reads env
// vars or builds clients (E3).
//
// A photo is queued for deletion before it is uploaded, and add_item takes it
// off the queue only when the gift is added. So a duplicate, a full list or a
// failed upload deletes the upload here straight away. An add_item that throws
// may still have committed, so its upload is left to the daily tick, which
// skips a path whose gift exists; a crash in between is cleared the same way
// (AC-9c).

/** The form's shape version. Bump it when the form changes; an older build is then told to update (E4, AC-21). */
const SHAPE_VERSION = "1";
/** lists.list_items.product_id's own check. */
const MAX_PRODUCT_ID_LENGTH = 128;

export type ExtensionAddInput = {
  /** A fresh id per request, made by the route: it names the photo's file. */
  itemId: string;
  name: string;
  priceCents: number;
  /** productLink(pageUrl, canonicalUrl): the canonical link keeping the page's variant, an http(s) link. */
  link: string;
  productId: string | null;
  confirmLikely: boolean;
  photo: Blob | null;
  /** list_photo_max_bytes, read by the route. */
  photoMaxBytes: number;
  /** list_max_items, read by the route (ALL-142). */
  maxItems: number;
};

export type AddItemArgs = {
  itemId: string;
  name: string;
  priceCents: number;
  productUrl: string;
  productId: string | null;
  photoUrl: string | null;
  confirmLikely: boolean;
  maxItems: number;
};

/** One row of lists.add_item; existing is set for "likely". */
export type AddItemRow = {
  outcome: string;
  listId: string | null;
  itemId: string | null;
  existing: { name?: unknown; price_cents?: unknown; image_url?: unknown } | null;
};

export type ExtensionAddStore = {
  userId: string;
  /** Service role: queue list-photos/{itemId}.jpg for deletion. */
  queuePhoto(itemId: string): Promise<void>;
  /** Service role: upload list-photos/{itemId}.jpg and return its public URL. */
  uploadPhoto(itemId: string, jpeg: Uint8Array): Promise<string>;
  /** Service role: delete list-photos/{itemId}.jpg. */
  deletePhoto(itemId: string): Promise<void>;
  /** As the user: lists.add_item. Errors carry the Postgres code as `code`. */
  addItem(args: AddItemArgs): Promise<AddItemRow>;
};

/** The JSON body the extension reads (shape version 1). */
export type ExtensionAddResponse =
  | { outcome: "added"; itemId: string }
  | { outcome: "duplicate" }
  | { outcome: "likely"; existing: { name: string; priceCents: number; imageUrl: string | null } }
  | { outcome: "full" }
  /** code "photo": the photo was refused, so the extension can offer to add without it. */
  | { error: string; code?: "photo" };

export type ExtensionAddResult = { status: number; body: ExtensionAddResponse };

export const UPDATE_EXTENSION = "Update the GiftsAF extension.";
const UNREADABLE = "That gift couldn't be read.";
const BAD_PHOTO = "That photo couldn't be used.";
const FAILED = "Couldn't add that gift. Try again.";

const optionalText = z
  .string()
  .optional()
  .transform((v) => v?.trim() || null);

const formSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  priceCents: z
    .string()
    .regex(/^\d{1,9}$/)
    .transform(Number)
    .refine((n) => n <= MAX_PRICE_CENTS),
  pageUrl: z.string(),
  canonicalUrl: optionalText,
  productId: optionalText,
  confirmLikely: z.string().optional(),
  photo: z.instanceof(Blob).optional(),
});

type ParseResult =
  | { ok: true; input: Omit<ExtensionAddInput, "itemId" | "photoMaxBytes" | "maxItems"> }
  | { ok: false; status: 400; error: string };

/** Validates the extension's multipart form (E4). The version is checked first, so an old build is told to update. */
export function parseExtensionAddForm(form: FormData): ParseResult {
  if (form.get("v") !== SHAPE_VERSION) return { ok: false, status: 400, error: UPDATE_EXTENSION };

  const field = (key: string) => form.get(key) ?? undefined;
  const parsed = formSchema.safeParse({
    name: field("name"),
    priceCents: field("priceCents"),
    pageUrl: field("pageUrl"),
    canonicalUrl: field("canonicalUrl"),
    productId: field("productId"),
    confirmLikely: field("confirmLikely"),
    photo: field("photo"),
  });
  if (!parsed.success) return { ok: false, status: 400, error: UNREADABLE };
  const f = parsed.data;

  // The canonical link comes from the page, so one that isn't a web link is ignored.
  const canonical = cleanUrl(f.canonicalUrl);
  const page = cleanUrl(f.pageUrl) ?? canonical;
  const link = page ? cleanUrl(productLink(page, canonical)) : null;
  if (!link) return { ok: false, status: 400, error: UNREADABLE };

  return {
    ok: true,
    input: {
      name: f.name,
      priceCents: f.priceCents,
      link,
      // Only used for the likely-duplicate check, so one too long to store is dropped.
      productId: f.productId && f.productId.length <= MAX_PRODUCT_ID_LENGTH ? f.productId : null,
      confirmLikely: f.confirmLikely === "1",
      photo: f.photo ?? null,
    },
  };
}

/** JPEG bytes within the size limit, or null. The bytes are checked, not just the declared type. */
async function readJpeg(photo: Blob, maxBytes: number): Promise<Uint8Array | null> {
  if (photo.type !== "" && photo.type !== "image/jpeg") return null;
  if (photo.size < 3 || photo.size > maxBytes) return null;
  const bytes = new Uint8Array(await photo.arrayBuffer());
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

function errorCode(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : null;
}

function toResult(row: AddItemRow, itemId: string): ExtensionAddResult {
  switch (row.outcome) {
    case "added":
      return { status: 201, body: { outcome: "added", itemId } };
    case "duplicate":
      return { status: 200, body: { outcome: "duplicate" } };
    case "full":
      return { status: 200, body: { outcome: "full" } };
    case "likely": {
      const e = row.existing ?? {};
      return {
        status: 200,
        body: {
          outcome: "likely",
          existing: {
            name: typeof e.name === "string" ? e.name : "",
            priceCents: typeof e.price_cents === "number" ? e.price_cents : 0,
            imageUrl: typeof e.image_url === "string" ? e.image_url : null,
          },
        },
      };
    }
    default:
      throw new Error("add_item gave an unknown outcome");
  }
}

/**
 * Adds one gift to the top of the user's list. With a photo: queue it, upload
 * it, then add; any outcome but "added", or an error before the add, deletes
 * the upload.
 * Logs one list.extension_add event, ids only (AC-22, E6).
 */
export async function addFromExtension(store: ExtensionAddStore, input: ExtensionAddInput): Promise<ExtensionAddResult> {
  const { itemId } = input;
  const ids = { user_id: store.userId };
  let uploaded = false;
  let addStarted = false;

  const dropPhoto = async () => {
    if (!uploaded) return;
    // Best effort: the queue row stays, so the tick removes it if this fails.
    await store.deletePhoto(itemId).catch(() => {});
  };

  try {
    let jpeg: Uint8Array | null = null;
    if (input.photo) {
      jpeg = await readJpeg(input.photo, input.photoMaxBytes);
      if (!jpeg) return { status: 400, body: { error: BAD_PHOTO, code: "photo" } };
    }

    let photoUrl: string | null = null;
    if (jpeg) {
      await store.queuePhoto(itemId);
      // From here a failed upload may still have left a file, so it's deleted either way.
      uploaded = true;
      photoUrl = await store.uploadPhoto(itemId, jpeg);
    }

    // From here an error can't tell whether the add committed, so the upload
    // is left to the daily tick, which never deletes a gift's own photo.
    addStarted = true;
    const row = await store.addItem({
      itemId,
      name: input.name,
      priceCents: input.priceCents,
      productUrl: input.link,
      productId: input.productId,
      photoUrl,
      confirmLikely: input.confirmLikely,
      maxItems: input.maxItems,
    });

    const result = toResult(row, itemId);
    if (row.outcome !== "added") await dropPhoto();
    logEvent("list.extension_add", {
      outcome: row.outcome,
      ...ids,
      ...(row.listId ? { list_id: row.listId } : {}),
      ...(row.outcome === "added" ? { item_id: itemId } : {}),
    });
    return result;
  } catch (e) {
    if (!addStarted) await dropPhoto();
    // E6: the error's type and Postgres code only; its message can quote the gift.
    logEvent("list.extension_add", {
      outcome: "failed",
      ...ids,
      item_id: itemId,
      error: e instanceof Error ? e.name : "unknown",
      ...(errorCode(e) ? { code: errorCode(e) } : {}),
    });
    return { status: 500, body: { error: FAILED } };
  }
}
