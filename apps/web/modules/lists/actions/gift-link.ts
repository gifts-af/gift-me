"use server";

import { readStorePage } from "@/modules/lists/actions/store-page";
import { readGiftLink, type GiftLinkRead } from "@/modules/lists/lib/gift-link";

const MAX_URL_LENGTH = 2048;

/**
 * Reads a pasted gift link for the signed-in user: name, price and photo where
 * the link or its page gives them (ALL-93). The page read checks sign-in
 * itself, so a signed-out caller gets only what the link gives.
 */
export async function readGiftLinkForUser(url: unknown): Promise<GiftLinkRead> {
  if (typeof url !== "string" || url.length > MAX_URL_LENGTH) return { ok: false, error: "That link is too long." };
  return readGiftLink(url, readStorePage);
}

/** The same link, cleaned (tracking tags, user:pass@), with no page read: for saving. */
export async function cleanGiftLink(url: unknown): Promise<GiftLinkRead> {
  if (typeof url !== "string" || url.length > MAX_URL_LENGTH) return { ok: false, error: "That link is too long." };
  return readGiftLink(url, null);
}
