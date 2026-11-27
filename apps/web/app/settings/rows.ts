import type { MyAddress } from "@/lib/account-address";
import type { MyBirthday } from "@/lib/account-birthday";
import type { MySizes } from "@/lib/account-sizes";
import { monthDay } from "@/lib/occasion-format";
import type { PaymentSummary } from "@/modules/concierge";
import type { MyList } from "@/modules/lists";

/** The right-hand text of Settings' "Paying for gifts" row (ALL-115 AC-9). */
const PAYMENT_TEXT: Record<PaymentSummary | "error", string> = {
  not_allowed: "Not available yet",
  off: "Not available yet",
  paused: "Paused",
  not_connected: "Not set up",
  waiting: "Connecting",
  needs_phone: "Add your phone",
  connected: "Connected",
  error: "Couldn't load",
};

export function paymentRowText(s: PaymentSummary | "error"): string {
  return PAYMENT_TEXT[s];
}

/** A card buyer's "Paying for gifts" row: a card saved, none, or paying by card switched off. */
export type CardSummary = { card: "saved" | "none" | "paused" };

export function cardRowText(s: CardSummary): string {
  return s.card === "saved" ? "Saved" : s.card === "none" ? "Not added" : "Paused";
}

/** The right-hand text of Settings' "My address" row (ALL-115 AC-6). */
export function addressRowText(a: MyAddress): string {
  if (a.kind === "unavailable") return "Couldn't load";
  return a.kind === "saved" ? a.address.line1 : "Not added";
}

/** The right-hand text of Settings' "Birthday" row. */
export function birthdayRowText(b: MyBirthday): string {
  if (b.kind === "unavailable") return "Couldn't load";
  return b.kind === "saved" ? monthDay(b) : "Not added";
}

/**
 * Birthday shows once you have a list, since it does nothing before that
 * (principle 10). A saved one always shows, so it can be removed.
 */
export function showBirthdayRow(b: MyBirthday, myList: MyList | null, on: boolean): boolean {
  return b.kind === "saved" || (on && (myList?.list != null || myList?.loadError != null));
}

/** The right-hand text of Settings' "Sizes and favorites" row. */
export function sizesRowText(s: MySizes): string {
  if (s.status === "unavailable") return "Couldn't load";
  const saved = Object.values(s.items).filter((item) => item !== null);
  if (saved.length === 0) return "Not added";
  const shared = saved.filter((item) => item.shared).length;
  if (shared === saved.length) return `${shared} shared`;
  return `${saved.length} saved, ${shared === 0 ? "none" : shared} shared`;
}

/** Shown once you have a list, like Birthday; anything saved always shows, so it can be removed. */
export function showSizesRow(s: MySizes, myList: MyList | null, on: boolean): boolean {
  const hasSaved = s.status === "loaded" && Object.values(s.items).some((item) => item !== null);
  return hasSaved || (on && (myList?.list != null || myList?.loadError != null));
}
