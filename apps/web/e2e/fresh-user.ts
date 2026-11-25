import { randomUUID } from "node:crypto";
import { localSupabase } from "./local-supabase";
import { rest } from "./rounds";

/** Lets an account into the concierge, which is by request. */
export async function giveAccess(userId: string): Promise<void> {
  await rest("accounts?on_conflict=user_id", { method: "POST", upsert: true, body: { user_id: userId, concierge_access: true } });
}

// A brand-new account for one test, for anything that depends on an empty
// list or no people. The shared test users race, because specs run in parallel.
// `displayName` sets the profile name, as sign-up's Name field does. It has the
// concierge unless `access` is false.
export async function createFreshUser(
  displayName?: string,
  { access = true }: { access?: boolean } = {},
): Promise<{ email: string; password: string }> {
  const { url, serviceRoleKey } = localSupabase();
  const user = { email: `e2e-${randomUUID()}@example.test`, password: "e2e-local-only-password" };
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...user,
      email_confirm: true,
      ...(displayName ? { user_metadata: { display_name: displayName } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Couldn't create a fresh user: ${res.status} ${await res.text()}`);
  if (access) await giveAccess(((await res.json()) as { id: string }).id);
  return user;
}
