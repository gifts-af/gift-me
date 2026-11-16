import { expect, test } from "@playwright/test";
import { createFreshUser } from "./fresh-user";
import { localSupabase } from "./local-supabase";
import { session, signIn } from "./sign-in";

// ALL-115: the Settings screen. This file starts with the hydration check for ALL-102.
// The browser's zone differs from the server's, so a time zone read from the browser
// during render shows up as a hydration error. The e2e runs a production build, where
// React's messages are minified, hence the error numbers.
test.use({ timezoneId: "America/Los_Angeles" });

const supabase = localSupabase();
const HYDRATION = /Hydration|#418|#423|#425/;

async function saveZone(userId: string, timezone: string) {
  const res = await fetch(`${supabase.url}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      apikey: supabase.serviceRoleKey,
      Authorization: `Bearer ${supabase.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ timezone }),
  });
  if (!res.ok) throw new Error(`Couldn't save a zone: ${res.status} ${await res.text()}`);
}

for (const saved of [true, false]) {
  // ALL-115 Task 5 removes this fixme.
  test.fixme(`@layout settings loads without a hydration error ${saved ? "with" : "without"} a saved zone`, async ({ page }) => {
    const user = await createFreshUser();
    if (saved) await saveZone((await session(user)).user.id, "Asia/Calcutta");
    await signIn(page, user);

    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));

    await page.goto("/settings");
    await expect(page.getByLabel("Time zone")).toBeVisible();
    // Hydration finishes after the first paint; give it a moment to report.
    await page.waitForLoadState("networkidle");

    expect(problems.filter((text) => HYDRATION.test(text))).toEqual([]);
  });
}
