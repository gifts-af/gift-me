import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { localSupabase } from "./local-supabase";
import { signIn } from "./sign-in";
import { TEST_USER } from "./test-user";

// ALL-28: a gift round from start to skip, against the local Supabase, with the
// tick's test clock (?now=). Saving a person calls the engine on the REAL time,
// so every date here is anchored on the real today (UTC).
//
// The tick is global: it also starts rounds for people other specs seed. So every
// assertion is scoped to this person's round id. The spec switches the engine on
// and always switches it back off.
// One browser only: it has no @layout tag, so only the iphone project runs it
// (playwright.config.ts), and the hooks below can't run in another worker and undo it. A reused local dev server must have
// been started with CRON_SECRET=e2e-cron-secret and EMAIL_OUTBOX=log (reuseExistingServer).
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
}) => {
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

  // An imported-style address (ALL-24 saves addresses unchecked): no recipient
  // names and a state written out. It fails the format check, so it counts as
  // no address (ALL-81 AC-10).
  const imported = await fetch(`${supabase.url}/rest/v1/people?id=eq.${personId}`, {
    method: "PATCH",
    headers: serviceHeaders,
    body: JSON.stringify({ address_line1: "1 Test Street", city: "Portland", state: "Oregon", zip: "97201", country: "US" }),
  });
  if (!imported.ok) throw new Error(`Couldn't seed the address: ${imported.status} ${await imported.text()}`);

  await setEngine(true);

  // 1. First tick: the round starts, and with no usable address it waits for one.
  expect(await tick(base, today)).toMatchObject({ ok: true, enabled: true });
  const rounds = await roundsFor(personId);
  expect(rounds).toHaveLength(1);
  const round = rounds[0];
  expect(round.status).toBe("needs_address");
  expect(round.late).toBe(true);
  const asked = (await notificationsFor(round.id)).filter((n) => n.kind === "needs_address");
  expect(asked).toHaveLength(1);
  expect(asked[0].sent_at).not.toBeNull();

  // 2. The email's "Add an address" button (an add_address link, stored the way
  // the app stores one) lands on the form, which shows what needs fixing
  // (ALL-81 AC-8, AC-10). Saving it resumes the round (AC-7).
  const linkToken = randomBytes(32).toString("base64url");
  const link = await fetch(`${supabase.url}/rest/v1/action_links`, {
    method: "POST",
    headers: concierge,
    body: JSON.stringify({
      user_id: (await signInApi()).id,
      action: "add_address",
      round_id: round.id,
      token_hash: createHash("sha256").update(linkToken).digest("hex"),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  });
  if (!link.ok) throw new Error(`Couldn't store the link: ${link.status} ${await link.text()}`);

  await signIn(page);
  await page.goto(`/a/${linkToken}`);
  await page.getByRole("button", { name: "Add an address", exact: true }).click();
  await page.getByRole("link", { name: "Open their page" }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${personId}\\?address=open`));

  const section = page.locator("#address");
  await expect(section.getByLabel("Street address")).toHaveValue("1 Test Street");
  await expect(section.getByText("Pick a state.")).toBeVisible();
  await expect(section.getByText("Add their first name.")).toBeVisible();
  await section.getByLabel("First name").fill("Rita");
  await section.getByLabel("Last name").fill("Engine");
  await section.getByLabel("State").selectOption("OR");
  await section.getByRole("button", { name: "Save address" }).click();
  await expect(section.getByText("Portland, OR 97201")).toBeVisible();

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
