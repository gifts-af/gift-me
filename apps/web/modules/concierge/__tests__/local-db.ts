// The real local Supabase for the local-db tests (E5): Postgres for direct checks, and the API
// (PostgREST through Kong) that the module code talks to. Locally a test file skips when the
// stack isn't running; in CI (`CI` set) it must be running, so a missing stack fails loudly
// instead of every money-path test quietly skipping.
import { Client } from "pg";
import { localSupabase, type LocalSupabase } from "../../../e2e/local-supabase";

// Supabase's fixed local database (supabase/config.toml, db.port).
export const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function postgresUp(): Promise<boolean> {
  const c = new Client({ connectionString: LOCAL_DB, connectionTimeoutMillis: 1000 });
  try {
    await c.connect();
    await c.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}

async function apiUp(s: LocalSupabase): Promise<boolean> {
  try {
    const res = await fetch(`${s.url}/rest/v1/`, { headers: { apikey: s.serviceRoleKey }, signal: AbortSignal.timeout(2000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * The local stack, or null to skip. `api: false` for tests that only use Postgres.
 * Throws in CI when it isn't reachable.
 */
export async function localStack(opts: { api: boolean }): Promise<{ supabase: LocalSupabase | null } | null> {
  let missing: string | null = null;
  let supabase: LocalSupabase | null = null;
  if (!(await postgresUp())) missing = "Postgres";
  else if (opts.api) {
    try {
      supabase = localSupabase();
    } catch {
      supabase = null;
    }
    if (!supabase || !(await apiUp(supabase))) missing = "the Supabase API";
  }
  if (missing === null) return { supabase };
  if (process.env.CI) throw new Error(`Local-db tests need ${missing} running (pnpm supabase start), and CI must start it.`);
  return null;
}
