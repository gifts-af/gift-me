"use server";

import { UUID_PATTERN, type GiftClaim } from "@/lib/lists";
import { createClient } from "@/lib/supabase/server";

const MAX_NAME_LENGTH = 80;

export type ClaimResult =
  | { ok: true; claim: GiftClaim }
  | { ok: false; error: string; alreadyClaimed?: boolean };

export type UnclaimResult = { ok: true } | { ok: false; error: string };

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Claims one gift on a shared list. A signed-in visitor is named by their
 * email (the database ignores `name` for them); a guest must give a name and
 * can't take the claim back. claim_gift re-checks all of this, including
 * that the owner isn't claiming their own gift.
 */
export async function claimGift(input: {
  token: string;
  itemId: string;
  name?: string;
}): Promise<ClaimResult> {
  if (!isUuid(input?.token) || !isUuid(input?.itemId)) {
    return { ok: false, error: "That gift couldn't be found." };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const signedIn = Boolean(auth?.claims);

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!signedIn && !name) return { ok: false, error: "Enter your name to claim this gift." };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Keep your name under ${MAX_NAME_LENGTH} characters.` };
  }

  const { data, error } = await supabase.rpc("claim_gift", {
    p_token: input.token,
    p_item_id: input.itemId,
    p_name: signedIn ? null : name,
  });

  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "You can't claim gifts on your own list." };
    }
    if (error.code === "P0002") {
      return { ok: false, error: "That gift is no longer on this list. Refresh the page." };
    }
    console.error("claim_gift failed", error);
    return { ok: false, error: "This gift couldn't be claimed. Try again." };
  }

  const result = data as { error?: string; name?: string; mine?: boolean } | null;
  if (result?.error === "already_claimed") {
    return { ok: false, error: "Someone just claimed this gift.", alreadyClaimed: true };
  }
  if (typeof result?.name !== "string") {
    console.error("claim_gift returned an unexpected result", data);
    return { ok: false, error: "This gift couldn't be claimed. Try again." };
  }

  return { ok: true, claim: { name: result.name, mine: result.mine === true } };
}

/** Takes back the signed-in visitor's own claim. Guest claims can't be undone. */
export async function unclaimGift(input: {
  token: string;
  itemId: string;
}): Promise<UnclaimResult> {
  if (!isUuid(input?.token) || !isUuid(input?.itemId)) {
    return { ok: false, error: "That gift couldn't be found." };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return { ok: false, error: "Log in to unclaim a gift." };

  const { data: removed, error } = await supabase.rpc("unclaim_gift", {
    p_token: input.token,
    p_item_id: input.itemId,
  });
  if (error) {
    console.error("unclaim_gift failed", error);
    return { ok: false, error: "This gift couldn't be unclaimed. Try again." };
  }
  if (removed !== true) {
    return { ok: false, error: "You don't have a claim on this gift. Refresh the page." };
  }
  return { ok: true };
}
