import { lookupProductLink } from "@/modules/lists/lib/product-link.js";
import type { LookupStorePageResult } from "@/modules/lists/lib/store-page-fetch";

// Reading a pasted gift link for other parts of the app (ALL-93's saved
// gifts), the way My list reads one: Amazon from the link itself, other
// stores from their page (decision 50). The page read is passed in (E3).

export type GiftLinkRead =
  | { ok: true; name: string | null; priceCents: number | null; imageUrl: string | null; productUrl: string }
  | { ok: false; error: string };

export type ReadPage = (url: string) => Promise<LookupStorePageResult | { ok: false; reason: "signed_out" }>;

// The saved-gift columns' fixed limits (supabase/migrations/…_saved_gifts.sql).
const MAX_NAME = 200;
const MAX_URL = 2048;

/** With `readPage` null, only cleans the link (tracking tags, user:pass@) and reads nothing. */
export async function readGiftLink(url: string, readPage: ReadPage | null): Promise<GiftLinkRead> {
  const link = await lookupProductLink(url);
  if (link.status === "error" || !link.product) {
    return { ok: false, error: link.error?.message ?? "That link couldn't be read." };
  }
  // product-link.js types its product only as `object`; these are its fields.
  const product = link.product as {
    name: string | null;
    priceCents: number | null;
    imageUrl: string | null;
    productUrl: string;
    source: string;
  };
  let name: string | null = product.name ?? null;
  let priceCents: number | null = product.priceCents ?? null;
  let imageUrl: string | null = product.imageUrl ?? null;

  if (readPage && product.source === "store-url") {
    try {
      const page = await readPage(product.productUrl);
      if (page.ok) {
        name = page.product.name ?? name;
        priceCents = page.product.priceCents ?? priceCents;
        imageUrl = page.product.imageUrl ?? imageUrl;
      }
    } catch {
      // Keep what the link gave: the buyer can type the rest.
    }
  }

  return {
    ok: true,
    name: name === null ? null : name.slice(0, MAX_NAME),
    priceCents,
    imageUrl: imageUrl !== null && imageUrl.length <= MAX_URL ? imageUrl : null,
    productUrl: product.productUrl,
  };
}
