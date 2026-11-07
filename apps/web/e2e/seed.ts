import { startingOccasions } from "@gifts-af/core";
import { localSupabase } from "./local-supabase";
import { session, type Credentials } from "./sign-in";

// Sets up data the way the app does, as the user, so a layout test can open the
// page it checks without stepping through forms that other tests cover (ALL-118).
async function rpc(user: Credentials, profile: "concierge" | "lists", name: string, args: object): Promise<unknown> {
  const { url, publishableKey } = localSupabase();
  const { access_token } = await session(user);
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
      "Content-Profile": profile,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Adds a mother, with the occasions the Add form starts her with. Returns her id. */
export async function addMother(user: Credentials, name: string): Promise<string> {
  return (await rpc(user, "concierge", "add_person", {
    p_name: name,
    p_relationship: "mother",
    p_kinds: startingOccasions("mother", { birthday: false, anniversary: false }),
  })) as string;
}

/** Saves a one-gift list, as pressing Save on My list does. */
export async function saveOneGiftList(user: Credentials): Promise<void> {
  await rpc(user, "lists", "save_list", {
    p_list_id: null,
    p_title: null,
    p_items: [{ id: null, name: "Wool socks", price_cents: 1200, image_url: null, product_url: null, asin: null, source: "manual", added_at: null }],
  });
}
