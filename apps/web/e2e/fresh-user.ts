import { randomUUID } from "node:crypto";
import { localSupabase } from "./local-supabase";

// A brand-new account for one test, for anything that depends on an empty
// list or no people. The shared test users race, because specs run in parallel.
export async function createFreshUser(): Promise<{ email: string; password: string }> {
  const { url, serviceRoleKey } = localSupabase();
  const user = { email: `e2e-${randomUUID()}@example.test`, password: "e2e-local-only-password" };
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...user, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`Couldn't create a fresh user: ${res.status} ${await res.text()}`);
  return user;
}
