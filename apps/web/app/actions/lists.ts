"use server";

import { MAX_PRICE_CENTS } from "@/lib/format.js";
import { LIST_ITEM_COLUMNS, rowToGift, type Gift } from "@/lib/lists";
import { createClient } from "@/lib/supabase/server";

const MAX_ITEMS = 500;
const MAX_NAME_LENGTH = 300;
const MAX_URL_LENGTH = 2048;

export type SaveListResult =
  | { ok: true; listId: string; items: Gift[] }
  | { ok: false; error: string };

type GiftInput = Partial<Omit<Gift, "id">>;

// Only http(s) links may be stored: anything else (javascript:, data:) would
// be rendered straight into an href or src for the owner later.
function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function cleanShortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function toRow(input: GiftInput) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH) return null;

  const priceCents = input.priceCents;
  if (
    typeof priceCents !== "number" ||
    !Number.isInteger(priceCents) ||
    priceCents < 0 ||
    priceCents > MAX_PRICE_CENTS
  ) {
    return null;
  }

  const addedAt =
    typeof input.addedAt === "number" && Number.isFinite(input.addedAt)
      ? new Date(input.addedAt).toISOString()
      : null;

  return {
    name,
    price_cents: priceCents,
    image_url: cleanUrl(input.imageUrl),
    product_url: cleanUrl(input.productUrl),
    asin: cleanShortText(input.asin, 20),
    source: cleanShortText(input.source, 40) ?? "manual",
    added_at: addedAt,
  };
}

/**
 * Replaces the caller's list with `items`, creating the list on first save.
 * Reachable by direct POST like any Server Action, so it re-checks auth and
 * re-validates everything the client sends; RLS is the backstop behind that.
 */
export async function saveList(input: {
  listId: string | null;
  items: GiftInput[];
}): Promise<SaveListResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return { ok: false, error: "Sign in to save your list." };

  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items) return { ok: false, error: "That list couldn't be read." };
  if (items.length > MAX_ITEMS) {
    return { ok: false, error: `A list can hold up to ${MAX_ITEMS} gifts.` };
  }

  const rows = items.map(toRow);
  if (rows.some((row) => row === null)) {
    return { ok: false, error: "One of the gifts has a missing name or an invalid price." };
  }

  const listId = typeof input.listId === "string" ? input.listId : null;

  const { data: savedId, error } = await supabase.rpc("save_list", {
    p_list_id: listId,
    p_title: null,
    p_items: rows,
  });
  if (error || typeof savedId !== "string") {
    console.error("save_list failed", error);
    return { ok: false, error: "Your list couldn't be saved. Try again." };
  }

  const { data: saved, error: readError } = await supabase
    .from("list_items")
    .select(LIST_ITEM_COLUMNS)
    .eq("list_id", savedId)
    .order("position", { ascending: true });
  if (readError) {
    console.error("reading saved list failed", readError);
    return { ok: false, error: "Your list was saved, but couldn't be reloaded. Refresh the page." };
  }

  return { ok: true, listId: savedId, items: (saved ?? []).map(rowToGift) };
}
