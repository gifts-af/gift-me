import { localSupabase } from "./local-supabase";
import { SECOND_USER, TEST_USER } from "./test-user";

type User = { email: string; password: string; displayName: string };

// Creates the test accounts, confirmed, so tests can sign in with email and
// password (local Supabase has no Google). Safe to run again.
export default async function globalSetup() {
  for (const user of [TEST_USER, SECOND_USER]) await createUser(user);
}

async function createUser(user: User) {
  const { url, serviceRoleKey } = localSupabase();
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { display_name: user.displayName },
    }),
  });
  const alreadyThere = res.status === 422;
  if (!res.ok && !alreadyThere) {
    throw new Error(`Couldn't create the test user ${user.email}: ${res.status} ${await res.text()}`);
  }
}
