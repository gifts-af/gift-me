// `pnpm live-check [playwright args]`: runs e2e-live/ on giftsaf.com, signed in
// as the shared test account (README > Production test account, T60).
//
// The sign-in form is closed to automated browsers by its bot check (ALL-68), so
// this gets a one-time login through the admin API instead. That needs the
// Supabase CLI login everyone already has (T25). Keys stay in this process. The
// session file lives outside the repo, and the session is ended after every run.
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";

const PROD_REF = "pegtrucfuaaufqvsavpb";
const SUPABASE_URL = `https://${PROD_REF}.supabase.co`;
const SITE_DOMAIN = "giftsaf.com";
const TEST_ACCOUNT = "allensforever711+qa@gmail.com";
const FOLDER_PREFIX = "live-check-";
const LEFTOVER_AFTER_MS = 60 * 60 * 1000;
const COOKIE_WAIT_MS = 5000;
const WEB_APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fail(message) {
  console.error(`live-check: ${message}`);
  process.exit(1);
}

function prodKeys() {
  let keys;
  try {
    const output = execSync(`pnpm --silent --dir ../.. exec supabase projects api-keys --project-ref ${PROD_REF} -o json`, {
      cwd: WEB_APP,
      stdio: ["ignore", "pipe", "ignore"],
    });
    keys = JSON.parse(output.toString());
  } catch {
    fail("couldn't read the production keys. Check you're online, and that `pnpm supabase login` was run in a terminal, as allensforever711 (T25).");
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

async function testAccountSession({ admin, anon }) {
  const { hashed_token: tokenHash } = await post("admin/generate_link", admin, { type: "magiclink", email: TEST_ACCOUNT });
  const session = await post("verify", anon, { type: "magiclink", token_hash: tokenHash });
  if (session.user?.email !== TEST_ACCOUNT) fail("the login wasn't for the test account, so nothing was run.");
  return session;
}

// The cookies the app itself would set after signing in.
async function sessionCookies(session, anon) {
  const jar = new Map();
  let written;
  const cookiesWritten = new Promise((resolve) => (written = resolve));
  const client = createServerClient(SUPABASE_URL, anon, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        // The first call only clears old cookies; wait for one holding the session.
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
        if (jar.size > 0) written();
      },
    },
  });
  const { error } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (error) fail("the one-time login didn't give a working session.");
  await Promise.race([cookiesWritten, new Promise((resolve) => setTimeout(resolve, COOKIE_WAIT_MS))]);
  if (jar.size === 0) fail("the session never produced any cookies, so nothing was run.");
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

// A run killed outright can't clean up after itself, so the next one does.
function removeLeftovers() {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(FOLDER_PREFIX)) continue;
    const folder = path.join(tmpdir(), name);
    if (Date.now() - statSync(folder).mtimeMs > LEFTOVER_AFTER_MS) rmSync(folder, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
// Both would record the session's cookies to disk.
if (args.some((arg) => arg.startsWith("--trace") || arg === "--ui")) {
  fail("--trace and --ui aren't allowed here, because they would save the session's cookies. Use --headed to watch.");
}

removeLeftovers();
const keys = prodKeys();
const session = await testAccountSession(keys);
const cookies = await sessionCookies(session, keys.anon);

const folder = mkdtempSync(path.join(tmpdir(), FOLDER_PREFIX));
process.on("exit", () => rmSync(folder, { recursive: true, force: true }));
const state = path.join(folder, "state.json");
writeFileSync(state, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });

// Directly through Node, with no shell, so arguments with spaces or `|` arrive intact.
const playwright = createRequire(import.meta.url).resolve("@playwright/test/cli");
const child = spawn(process.execPath, [playwright, "test", "--config", "playwright.live.config.ts", ...args], {
  cwd: WEB_APP,
  stdio: "inherit",
  env: { ...process.env, LIVE_CHECK_STATE: state, LIVE_CHECK_BASE_URL: `https://${SITE_DOMAIN}` },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));

const code = await new Promise((resolve) => {
  child.on("error", (error) => {
    console.error(`live-check: couldn't start Playwright: ${error.message}`);
    resolve(1);
  });
  child.on("close", (status) => resolve(status ?? 1));
});

// End the session too, not just its file.
const ended = await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
  method: "POST",
  headers: { apikey: keys.anon, Authorization: `Bearer ${session.access_token}` },
});
if (!ended.ok) console.error(`live-check: couldn't end the session (${ended.status}). It expires by itself.`);
process.exit(code);
