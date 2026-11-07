import { expect, test, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { localSupabase } from "./local-supabase";
import { TEST_USER } from "./test-user";

export type Credentials = { email: string; password: string };

export type Session = { access_token: string; refresh_token: string; user: { id: string } };

/** A session for `user` from the local Supabase, by email and password: its tokens and user id. */
export async function session(user: Credentials): Promise<Session> {
  const { url, publishableKey } = localSupabase();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!res.ok) throw new Error(`Couldn't sign in ${user.email}: ${res.status} ${await res.text()}`);
  return (await res.json()) as Session;
}

/**
 * Signs `page` in as `user` without the login form (ALL-103): it gets a
 * session from the local Supabase and sets the cookies the app itself would
 * set. It doesn't open a page, so go to the page under test next.
 * smoke.spec.ts still signs in through the real form.
 */
export async function signIn(page: Page, user: Credentials = TEST_USER): Promise<void> {
  const { url, publishableKey } = localSupabase();
  const { access_token, refresh_token } = await session(user);

  const jar = new Map<string, string>();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { error } = await client.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
  // @supabase/ssr can write the cookies a moment after setSession returns.
  await expect.poll(() => jar.size).toBeGreaterThan(0);

  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("signIn needs the project's baseURL");
  await page.context().addCookies([...jar].map(([name, value]) => ({ name, value, url: baseURL })));
}
