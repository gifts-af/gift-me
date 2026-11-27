import { clearConnectSwitch } from "./connect-switch";
import { startFakeGateway } from "./fake-gateway";
import { startFakeStripe } from "./fake-stripe";
import { startFakeZinc } from "./fake-zinc";
import { giveAccess } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { session } from "./sign-in";
import { SECOND_USER, TEST_USER } from "./test-user";

type User = { email: string; password: string; displayName: string };

// Creates the test accounts, confirmed and let into the concierge, so tests can sign in
// with email and password (local Supabase has no Google). Safe to run again.
export default async function globalSetup() {
  for (const user of [TEST_USER, SECOND_USER]) await createUser(user);
  // Zinc's stand-in for paying-for-gifts.spec.ts (ALL-32), and the AI Gateway's for the idea
  // engine (ALL-27). Not needed against a deployed site.
  if (process.env.E2E_BASE_URL) return;
  const servers = [await startFakeZinc(), await startFakeGateway(), await startFakeStripe()];
  clearConnectSwitch();
  const before = new Map<string, unknown>();
  for (const key of [...Object.keys(RUN_SETTINGS), ...SPEC_SWITCHES]) before.set(key, await getSetting(key));
  for (const [key, value] of Object.entries(RUN_SETTINGS)) await setSetting(key, value);
  return async () => {
    await Promise.all(servers.map((s) => new Promise<void>((done) => s.close(() => done()))));
    for (const [key, value] of before) await setSetting(key, value);
  };
}

// Settings specs need for the whole run, set once here because specs run at the same
// time and one spec putting a value back would pull it from under another (ALL-29):
// - buying on, for approval.spec.ts's purchases, which go to the fake Zinc;
// - Google import on, for contacts-import.spec.ts;
// - room in the tick's idea pass, which is global: every spec's rounds want a turn, and every run
//   of the day counts (ALL-125). The fakes answer at once, so a high limit stays well inside the tick.
const RUN_SETTINGS: Record<string, number> = {
  zinc_ordering_enabled: 1,
  google_import_enabled: 1,
  idea_rounds_per_tick: 100,
  idea_round_runs_per_day: 100,
  // Paying by card on, for card-payments.spec.ts: it only changes anything for card accounts,
  // which no other spec has.
  connect_enabled: 1,
};
// suggest-ideas.spec.ts, round-engine.spec.ts and approval.spec.ts switch the engines on, and run
// at the same time, so none switches them back: the teardown does, once every spec has finished.
const SPEC_SWITCHES = ["round_engine_enabled", "idea_engine_enabled"];
// The teardown puts back the values found at the start. `pnpm e2e` cleans the database first
// (scripts/db-clean.mjs), so those are the seeded values; a run killed before its teardown is
// put right by the next run's clean.

function settingsRequest(query: string, init: RequestInit = {}) {
  const { url, serviceRoleKey } = localSupabase();
  return fetch(`${url}/rest/v1/app_settings?${query}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "Accept-Profile": "concierge",
      "Content-Profile": "concierge",
    },
  });
}

async function getSetting(key: string): Promise<unknown> {
  const res = await settingsRequest(`key=eq.${key}&select=value`);
  if (!res.ok) throw new Error(`Couldn't read ${key}: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as { value: unknown }[];
  if (rows.length !== 1) throw new Error(`No ${key} in app_settings`);
  return rows[0].value;
}

async function setSetting(key: string, value: unknown) {
  const res = await settingsRequest(`key=eq.${key}`, { method: "PATCH", body: JSON.stringify({ value }) });
  if (!res.ok) throw new Error(`Couldn't set ${key}: ${res.status} ${await res.text()}`);
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
  // An account that was already there comes back with no id, so ask with its session.
  await giveAccess((await session(user)).user.id);
}
