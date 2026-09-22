import { createClient } from "@/lib/supabase/server";

// The shape the gift components already work with (see components/gifts).
export type Gift = {
  id: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
  productUrl: string | null;
  asin: string | null;
  source: string;
  addedAt: number;
};

export type MyList = {
  user: { email: string | null };
  list: { id: string; title: string } | null;
  items: Gift[];
  // Set when the saved list couldn't be read. The app still renders, but
  // saving is blocked: a save now would start a second, near-empty list.
  loadError: string | null;
};

export type ListItemRow = {
  id: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  product_url: string | null;
  asin: string | null;
  source: string;
  added_at: string;
};

export const LIST_ITEM_COLUMNS =
  "id, name, price_cents, image_url, product_url, asin, source, added_at";

export function rowToGift(row: ListItemRow): Gift {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    asin: row.asin,
    source: row.source,
    addedAt: Date.parse(row.added_at),
  };
}

const LOAD_ERROR = "We couldn't load your saved list, so saving is paused. Refresh to try again.";

/**
 * The signed-in user's list, or null for a guest. A user may own several
 * lists; until the UI can switch between them, the oldest one is "the" list.
 * A database failure is reported through loadError rather than thrown, so one
 * bad query can't take the whole page down.
 */
export async function getMyList(): Promise<MyList | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims) return null;

  const user = { email: typeof claims.email === "string" ? claims.email : null };

  const { data: list, error: listError } = await supabase
    .from("lists")
    .select("id, title")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (listError) {
    console.error("loading lists failed", listError);
    return { user, list: null, items: [], loadError: LOAD_ERROR };
  }
  if (!list) return { user, list: null, items: [], loadError: null };

  const { data: rows, error: itemsError } = await supabase
    .from("list_items")
    .select(LIST_ITEM_COLUMNS)
    .eq("list_id", list.id)
    .order("position", { ascending: true });

  if (itemsError) {
    console.error("loading list items failed", itemsError);
    return { user, list: null, items: [], loadError: LOAD_ERROR };
  }

  return { user, list, items: (rows ?? []).map(rowToGift), loadError: null };
}
