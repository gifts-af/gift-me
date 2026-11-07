import { localSupabase } from "./local-supabase";

// Sets up data the way the app does, as the user, so a layout test can open the
// page it checks without stepping through forms that other tests cover (ALL-118).
type User = { email: string; password: string };

async function session(user: User): Promise<{ token: string; id: string }> {
  const { url, publishableKey } = localSupabase();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!res.ok) throw new Error(`Couldn't sign in ${user.email}: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, id: body.user.id };
}

async function rpc(user: User, profile: "concierge" | "lists", name: string, args: object): Promise<unknown> {
  const { url, publishableKey } = localSupabase();
  const { token } = await session(user);
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Profile": profile,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Adds a mother, with the occasions the Add form picks for one. Returns her id. */
export async function addMother(user: User, name: string): Promise<string> {
  return (await rpc(user, "concierge", "add_person", {
    p_name: name,
    p_relationship: "mother",
    p_kinds: ["christmas", "mothers_day"],
  })) as string;
}

/** Saves a one-gift list, as pressing Save on My list does. */
export async function saveOneGiftList(user: User): Promise<void> {
  await rpc(user, "lists", "save_list", {
    p_list_id: null,
    p_title: null,
    p_items: [{ id: null, name: "Wool socks", price_cents: 1200, image_url: null, product_url: null, asin: null, source: "manual", added_at: null }],
  });
}
