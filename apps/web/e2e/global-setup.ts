import { localSupabase } from "./local-supabase";
import { TEST_USER } from "./test-user";

// Creates the test account, confirmed, so the smoke test can sign in with
// email and password (local Supabase has no Google). Safe to run again.
export default async function globalSetup() {
  const { url, serviceRoleKey } = localSupabase();
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: TEST_USER.email,
      password: TEST_USER.password,
      email_confirm: true,
      user_metadata: { display_name: TEST_USER.displayName },
    }),
  });
  const alreadyThere = res.status === 422;
  if (!res.ok && !alreadyThere) {
    throw new Error(`Couldn't create the test user: ${res.status} ${await res.text()}`);
  }
}
