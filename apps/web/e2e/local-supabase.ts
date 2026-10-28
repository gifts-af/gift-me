import { execSync } from "node:child_process";
import path from "node:path";

// Browser tests run against the local Supabase in Docker, never `dev` or
// `prod`. CI sets these from `supabase status`; locally they're read from the
// running stack.
export type LocalSupabase = { url: string; publishableKey: string; serviceRoleKey: string };

export function localSupabase(): LocalSupabase {
  const fromEnv = {
    url: process.env.E2E_SUPABASE_URL,
    publishableKey: process.env.E2E_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromEnv.url && fromEnv.publishableKey && fromEnv.serviceRoleKey) return fromEnv as LocalSupabase;

  const out = execSync("pnpm -s supabase status -o env", {
    cwd: path.resolve(__dirname, "../../.."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const vars = Object.fromEntries(
    out
      .split("\n")
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  if (!vars.API_URL) throw new Error("Local Supabase isn't running. Start it with `pnpm supabase start`.");
  return {
    url: vars.API_URL,
    publishableKey: vars.PUBLISHABLE_KEY ?? vars.ANON_KEY,
    serviceRoleKey: vars.SERVICE_ROLE_KEY,
  };
}
