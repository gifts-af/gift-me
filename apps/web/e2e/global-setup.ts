import { startFakeGateway } from "./fake-gateway";
import { startFakeZinc } from "./fake-zinc";
import { localSupabase } from "./local-supabase";
import { SECOND_USER, TEST_USER } from "./test-user";

type User = { email: string; password: string; displayName: string };

// Creates the test accounts, confirmed, so tests can sign in with email and
// password (local Supabase has no Google). Safe to run again.
export default async function globalSetup() {
  for (const user of [TEST_USER, SECOND_USER]) await createUser(user);
  // Zinc's stand-in for paying-for-gifts.spec.ts (ALL-32), and the AI Gateway's for the idea
  // engine (ALL-27). Not needed against a deployed site.
  if (process.env.E2E_BASE_URL) return;
  const servers = [await startFakeZinc(), await startFakeGateway()];
  return async () => {
    await Promise.all(servers.map((s) => new Promise<void>((done) => s.close(() => done()))));
    await ideasOff();
  };
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

// suggest-ideas.spec.ts and round-engine.spec.ts turn the idea engine on, and run at the same
// time, so neither turns it off: this does, once every spec has finished. It ships off.
async function ideasOff() {
  const { url, serviceRoleKey } = localSupabase();
  const res = await fetch(`${url}/rest/v1/app_settings?key=eq.idea_engine_enabled`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "Content-Profile": "concierge",
    },
    body: JSON.stringify({ value: 0 }),
  });
  if (!res.ok) throw new Error(`Couldn't switch the idea engine off: ${res.status} ${await res.text()}`);
}
