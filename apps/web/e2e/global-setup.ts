import { readFileSync } from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { startFakeZinc } from "./fake-zinc";
import { localSupabase } from "./local-supabase";
import { SECOND_USER, TEST_USER } from "./test-user";

type User = { email: string; password: string; displayName: string };

// Creates the test accounts, confirmed, so tests can sign in with email and
// password (local Supabase has no Google). Safe to run again.
export default async function globalSetup(config: FullConfig) {
  // Not against a deployed site (E2E_BASE_URL): that server is the point.
  if (!process.env.E2E_BASE_URL) await checkServerIsThisBuild(config);
  for (const user of [TEST_USER, SECOND_USER]) await createUser(user);
  // Zinc's stand-in for paying-for-gifts.spec.ts (ALL-32). Not needed against a deployed site.
  if (process.env.E2E_BASE_URL) return;
  const zinc = await startFakeZinc();
  return () => new Promise<void>((done) => zinc.close(() => done()));
}

// ALL-108: if another checkout takes the port while this run builds, our server
// fails with EADDRINUSE and Playwright finds theirs answering instead, so the
// tests would pass or fail on someone else's code. Next puts the build id in
// every page ("b":"<id>"), so the server must show this checkout's .next/BUILD_ID.
async function checkServerIsThisBuild(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL;
  // No BUILD_ID yet means Playwright found a server while this run was still building.
  const buildId = readBuildId();
  const page = await fetch(`${baseURL}/e2e-build-check`).then((res) => res.text());
  if (!buildId || !page.includes(buildId)) {
    throw new Error(
      `The server at ${baseURL} isn't this checkout's build (${buildId ?? "not built yet"}). Another checkout ` +
        `probably took the port while this run was building; look for EADDRINUSE above. ` +
        `Stop that server or set E2E_PORT, then run again.`,
    );
  }
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

function readBuildId(): string | undefined {
  try {
    return readFileSync(path.resolve(__dirname, "../.next/BUILD_ID"), "utf8").trim();
  } catch {
    return undefined;
  }
}
