import { parseBudget } from "../people/rules";

// Saved gifts for someone (ALL-93, planning decision 54): the form's rules.
// The limits match the table's fixed column checks (…_saved_gifts.sql), so a
// bad value gets a plain message here instead of a database error.

export type SavedGiftInput = {
  name: string;
  priceCents: number | null;
  productUrl: string | null;
  imageUrl: string | null;
};

export type SavedGift = SavedGiftInput & { id: string };

const MAX_NAME = 200;
const MAX_URL = 2048;
const MAX_PRICE_CENTS = 10_000_000;

function webAddress(value: string): boolean {
  return value.length <= MAX_URL && /^https?:\/\//i.test(value);
}

function field(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function parseSavedGiftForm(
  formData: FormData,
): { ok: true; value: SavedGiftInput } | { ok: false; error: string } {
  const name = field(formData, "name");
  if (!name) return { ok: false, error: "Give the gift a name." };
  if (name.length > MAX_NAME) return { ok: false, error: "Keep the name under 200 characters." };

  const price = parseBudget(field(formData, "price"));
  if (!price.ok) return price;
  if (price.cents !== null && price.cents > MAX_PRICE_CENTS) {
    return { ok: false, error: "Enter an amount up to $100,000." };
  }

  const link = field(formData, "link");
  if (link && !webAddress(link)) return { ok: false, error: "That link doesn't look right." };

  // The photo comes from reading the link, never from the buyer, so a bad one
  // is dropped rather than failing a save they couldn't fix.
  const image = field(formData, "image");

  return {
    ok: true,
    value: {
      name,
      priceCents: price.cents,
      productUrl: link || null,
      imageUrl: image && webAddress(image) ? image : null,
    },
  };
}
