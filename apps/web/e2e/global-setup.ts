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
  const before = await settingsForRun();
  return async () => {
    await Promise.all(servers.map((s) => new Promise<void>((done) => s.close(() => done()))));
    await ideasOff();
    for (const [key, value] of Object.entries(before)) await setSetting(key, value);
  };
}

// Settings the round specs need for the whole run, set once here because specs run at the same
// time and one spec putting a value back would pull it from under another (ALL-29):
// - buying on (it ships off), for approval.spec.ts's purchases, which go to the fake Zinc;
// - room in the tick's idea pass, which is global: every spec's rounds want a turn, and every run
//   of the day counts (ALL-125). The fakes answer at once, so a high limit stays well inside the tick.
// Returns what they were, for the teardown.
const RUN_SETTINGS: Record<string, number> = {
  zinc_ordering_enabled: 1,
  idea_rounds_per_tick: 100,
  idea_round_runs_per_day: 100,
};

async function settingsForRun(): Promise<Record<string, string>> {
  const { url, serviceRoleKey } = localSupabase();
  const keys = Object.keys(RUN_SETTINGS);
  const res = await fetch(`${url}/rest/v1/app_settings?select=key,value&key=in.(${keys.join(",")})`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Accept-Profile": "concierge" },
  });
  if (!res.ok) throw new Error(`Couldn't read the run's settings: ${res.status} ${await res.text()}`);
  const before = Object.fromEntries(((await res.json()) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  for (const [key, value] of Object.entries(RUN_SETTINGS)) await setSetting(key, value);
  return before;
}

async function setSetting(key: string, value: string | number) {
  const { url, serviceRoleKey } = localSupabase();
  const res = await fetch(`${url}/rest/v1/app_settings?key=eq.${key}`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "Content-Profile": "concierge",
    },
    body: JSON.stringify({ value }),
  });
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
}

// suggest-ideas.spec.ts, round-engine.spec.ts and approval.spec.ts turn the idea engine on, and
// run at the same time, so none turns it off: this does, once every spec has finished. It ships
// off. The round engine too: approval.spec.ts leaves it on, so round-engine.spec.ts can't switch
// it off under its ticks.
async function ideasOff() {
  await setSetting("round_engine_enabled", 0);
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
