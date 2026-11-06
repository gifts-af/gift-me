// `pnpm live-check [playwright args]`: runs e2e-live/ on giftsaf.com, signed in
// as the shared test account (README > Production test account, T60).
//
// The sign-in form is closed to automated browsers by its bot check (ALL-68), so
// this gets a one-time login through the admin API instead. That needs the
// Supabase CLI login everyone already has (T25). Keys stay in this process, and
// the session file lives outside the repo and is deleted after every run.
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";

const PROD_REF = "pegtrucfuaaufqvsavpb";
const SUPABASE_URL = `https://${PROD_REF}.supabase.co`;
const SITE_DOMAIN = "giftsaf.com";
const TEST_ACCOUNT = "allensforever711+qa@gmail.com";

function fail(message) {
  console.error(`live-check: ${message}`);
  process.exit(1);
}

function prodKeys() {
  let keys;
  try {
    const output = execSync(`pnpm --silent --dir ../.. exec supabase projects api-keys --project-ref ${PROD_REF} -o json`, {
      stdio: ["ignore", "pipe", "ignore"],
    });
    keys = JSON.parse(output.toString());
  } catch {
    fail("couldn't read the production keys. Run `pnpm supabase login` in a terminal, as allensforever711 (T25), then try again.");
  }
  const admin = keys.find((key) => key.name === "service_role")?.api_key;
  const anon = keys.find((key) => key.name === "anon")?.api_key;
  if (!admin || !anon) fail("the production project didn't return its service_role and anon keys.");
  return { admin, anon };
}

async function post(endpoint, key, body) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) fail(`${endpoint} failed with ${response.status}. Does ${TEST_ACCOUNT} still exist on production?`);
  return response.json();
}

// The cookies the app itself would set after signing in.
async function sessionCookies({ admin, anon }) {
  const { hashed_token: tokenHash } = await post("admin/generate_link", admin, { type: "magiclink", email: TEST_ACCOUNT });
  const session = await post("verify", anon, { type: "magiclink", token_hash: tokenHash });

  const jar = new Map();
  const client = createServerClient(SUPABASE_URL, anon, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (error) fail("the one-time login didn't give a working session.");
  // The cookies are written just after setSession resolves.
  await new Promise((resolve) => setTimeout(resolve, 200));
  return [...jar].map(([name, value]) => ({
    name,
    value,
    domain: SITE_DOMAIN,
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  }));
}

const cookies = await sessionCookies(prodKeys());

const folder = mkdtempSync(path.join(tmpdir(), "live-check-"));
const removeSession = () => rmSync(folder, { recursive: true, force: true });
process.on("exit", removeSession);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(1));

const state = path.join(folder, "state.json");
writeFileSync(state, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const run = spawnSync("pnpm", ["exec", "playwright", "test", "--config", "playwright.live.config.ts", ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, LIVE_CHECK_STATE: state },
});
process.exit(run.status ?? 1);
