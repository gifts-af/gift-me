import { expect, test } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { TEST_USER } from "./test-user";

// ALL-28: a gift round from start to skip, against the local Supabase, with the
// tick's test clock (?now=). Saving a person calls the engine on the REAL time,
// so every date here is anchored on the real today (UTC).
//
// The tick is global: it also starts rounds for people other specs seed. So every
// assertion is scoped to this person's round id. The spec switches the engine on
// and always switches it back off.
test.describe.configure({ mode: "serial" });

const supabase = localSupabase();
const CRON_SECRET = "e2e-cron-secret";
const PERSON = "Round Engine Rita";
const DAY_MS = 24 * 60 * 60 * 1000;

const serviceHeaders = {
  apikey: supabase.serviceRoleKey,
  Authorization: `Bearer ${supabase.serviceRoleKey}`,
  "Content-Type": "application/json",
};
const concierge = { ...serviceHeaders, "Accept-Profile": "concierge", "Content-Profile": "concierge" };

async function signInApi(): Promise<{ token: string; id: string }> {
  const res = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
  });
  if (!res.ok) throw new Error(`Couldn't sign in: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, id: body.user.id };
}

async function setEngine(on: boolean) {
  const res = await fetch(`${supabase.url}/rest/v1/app_settings?key=eq.round_engine_enabled`, {
    method: "PATCH",
    headers: concierge,
    body: JSON.stringify({ value: on ? 1 : 0 }),
  });
  if (!res.ok) throw new Error(`Couldn't set round_engine_enabled: ${res.status} ${await res.text()}`);
}

// Rounds and notifications cascade from the person.
async function deletePerson() {
  const { id } = await signInApi();
  const res = await fetch(`${supabase.url}/rest/v1/people?user_id=eq.${id}&name=eq.${encodeURIComponent(PERSON)}`, {
    method: "DELETE",
    headers: serviceHeaders,
  });
  if (!res.ok) throw new Error(`Couldn't clear the test person: ${res.status} ${await res.text()}`);
}

async function tick(base: string, day: string) {
  const res = await fetch(new URL(`/api/rounds/tick?now=${day}T12:00:00Z`, base), {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return JSON.parse(text) as { ok: boolean; enabled: boolean };
}

type Round = { id: string; status: string; ship_by_deadline: string; late: boolean };

async function roundsFor(personId: string): Promise<Round[]> {
  const res = await fetch(
    `${supabase.url}/rest/v1/gift_rounds?select=id,status,ship_by_deadline,late&person_id=eq.${personId}`,
    { headers: concierge },
  );
  return (await res.json()) as Round[];
}

async function notificationsFor(roundId: string): Promise<{ kind: string; sent_at: string | null }[]> {
  const res = await fetch(
    `${supabase.url}/rest/v1/notifications?select=kind,sent_at&round_id=eq.${roundId}&order=created_at`,
    { headers: concierge },
  );
  return (await res.json()) as { kind: string; sent_at: string | null }[];
}

test.beforeAll(async () => {
  await setEngine(false); // in case a crashed run left it on
  await deletePerson();
});

test.afterAll(async () => {
  await setEngine(false);
  await deletePerson();
});

test("a round starts without an address, resumes when one is saved, and is skipped at the deadline", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One run is enough: the tick isn't layout-dependent.");
  const base = baseURL ?? "http://localhost:3100";

  // A birthday 35 days from today: the planning deadline is 9 days before it,
  // and the normal start 28 days before that is already past, so the round starts today, late.
  const today = new Date().toISOString().slice(0, 10);
  const birthday = new Date(Date.now() + 35 * DAY_MS);

  const { token } = await signInApi();
  const added = await fetch(`${supabase.url}/rest/v1/rpc/add_person`, {
    method: "POST",
    headers: {
      apikey: supabase.publishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Profile": "concierge",
    },
    body: JSON.stringify({
      p_name: PERSON,
      p_relationship: "friend",
      p_kinds: ["birthday"],
      p_birthday_month: birthday.getUTCMonth() + 1,
      p_birthday_day: birthday.getUTCDate(),
    }),
  });
  if (!added.ok) throw new Error(`Couldn't add the test person: ${added.status} ${await added.text()}`);
  const personId = (await added.json()) as string;

  await setEngine(true);

  // 1. First tick: the round starts, and with no address it waits for one.
  expect(await tick(base, today)).toMatchObject({ ok: true, enabled: true });
  const rounds = await roundsFor(personId);
  expect(rounds).toHaveLength(1);
  const round = rounds[0];
  expect(round.status).toBe("needs_address");
  expect(round.late).toBe(true);
  const asked = (await notificationsFor(round.id)).filter((n) => n.kind === "needs_address");
  expect(asked).toHaveLength(1);
  expect(asked[0].sent_at).not.toBeNull();

  // 2. An address arrives and the person is saved from their page: the round resumes.
  // (There's no address field on the page yet, so the address goes in by the service key;
  // saving the page is what calls the engine.)
  const filled = await fetch(`${supabase.url}/rest/v1/people?id=eq.${personId}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify({
      recipient_first_name: "Rita",
      recipient_last_name: "Engine",
      address_line1: "1 Test Street",
      city: "Portland",
      state: "OR",
      zip: "97201",
    }),
  });
  if (!filled.ok) throw new Error(`Couldn't save the address: ${filled.status} ${await filled.text()}`);

  await page.goto("/auth/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await page.goto(`/people/${personId}`);
  await expect(page.getByRole("heading", { name: "Edit", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect.poll(async () => (await roundsFor(personId))[0].status).toBe("awaiting_approval");
  expect((await notificationsFor(round.id)).filter((n) => n.kind === "heads_up")).toHaveLength(1);

  // 3. The deadline day: nothing was approved, so the round is skipped and she is told.
  const deadline = round.ship_by_deadline;
  expect(await tick(base, deadline)).toMatchObject({ ok: true });
  expect((await roundsFor(personId))[0].status).toBe("skipped");
  const afterSkip = await notificationsFor(round.id);
  const skipped = afterSkip.filter((n) => n.kind === "skipped");
  expect(skipped).toHaveLength(1);
  expect(skipped[0].sent_at).not.toBeNull();

  // 4. Ticking again sends nothing more.
  await tick(base, deadline);
  expect(await notificationsFor(round.id)).toHaveLength(afterSkip.length);
  expect((await roundsFor(personId))[0].status).toBe("skipped");
});
