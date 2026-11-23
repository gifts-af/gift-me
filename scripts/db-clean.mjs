// One test run at a time on the local database, on a clean slate (design/operations.md >
// Sharing the local database). Several checkouts share one local Supabase, so:
//
// 1. Take a Postgres advisory lock and hold it for the whole run. Another run waits its turn.
//    The lock lives on this process's connection, so it goes when the process does: on exit,
//    a crash or Ctrl-C. A dead run can never block the next one.
// 2. Clean: delete the test accounts (their rows cascade) and put every app_settings value
//    back to what a fresh `supabase db reset` gives (the migrations, then seed.sql). Values are
//    read from those files, so this never drifts from them.
// 3. Run the command given, if any, still holding the lock, and exit with its code.
//
//   node scripts/db-clean.mjs                 clean only (pnpm db:clean)
//   node scripts/db-clean.mjs <command...>    clean, then run the command (pnpm test:db, e2e, ...)
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supabaseDir = path.join(root, "supabase");

// Test accounts use the reserved example domains (RFC 2606): name@example.com, name@example.test,
// and health-db's name@example.com.<id>.test. seed.sql creates no users, so nothing seeded matches.
const TEST_USERS = String.raw`@example\.(com|test)$|@example\.com\.[^@]+\.test$`;
// Tests date their tick heartbeats in far-off years; real ticks never get near.
const TEST_HEARTBEATS_FROM = "2100-01-01";
// The lock's key. The two-number form keeps it apart from the app's own one-number advisory locks.
const LOCK_KEY = "0, hashtext('gifts-af local test run')";

/** key -> value (JSON text), as a fresh database has them: migration inserts, then any updates. */
function seededSettings() {
  const files = readdirSync(path.join(supabaseDir, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(supabaseDir, "migrations", f));
  files.push(path.join(supabaseDir, "seed.sql"));
  const values = new Map();
  for (const file of files) {
    const sql = readFileSync(file, "utf8").replace(/^\s*--.*$/gm, "");
    for (const m of sql.matchAll(/insert into concierge\.app_settings\s*\([^)]*\)\s*values/gi)) {
      // Each row is ('key', 'value'[, 'description']); a description may hold ; or ).
      const row = /\s*\(\s*'([a-z0-9_]+)'\s*,\s*'((?:[^']|'')*)'\s*(?:,\s*'(?:[^']|'')*'\s*)*\)\s*,?/y;
      row.lastIndex = m.index + m[0].length;
      const rows = [];
      let end = row.lastIndex;
      let t;
      while ((t = row.exec(sql))) {
        rows.push([t[1], t[2].replaceAll("''", "'")]);
        end = row.lastIndex;
      }
      if (!rows.length) throw new Error(`db:clean can't read the app_settings insert in ${path.basename(file)}`);
      const keepOld = /^\s*on conflict \(key\) do nothing/i.test(sql.slice(end));
      for (const [key, value] of rows) if (!(keepOld && values.has(key))) values.set(key, value);
    }
    for (const u of sql.matchAll(/update concierge\.app_settings\s+set value\s*=\s*'((?:[^']|'')*)'\s+where key\s*=\s*'([a-z0-9_]+)'/gi)) {
      values.set(u[2], u[1].replaceAll("''", "'"));
    }
  }
  return values;
}

async function clean(db) {
  const seeded = seededSettings();
  await db.query("begin");
  try {
    const users = await db.query("delete from auth.users where email ~* $1", [TEST_USERS]);
    await db.query("delete from concierge.tick_heartbeats where day >= $1", [TEST_HEARTBEATS_FROM]);
    const reset = await db.query(
      `update concierge.app_settings s set value = v.value::jsonb
         from unnest($1::text[], $2::text[]) as v(key, value)
        where s.key = v.key and s.value is distinct from v.value::jsonb
        returning s.key`,
      [[...seeded.keys()], [...seeded.values()]],
    );
    // Another checkout's migration can add a setting this checkout doesn't know yet: leave it.
    const unknown = await db.query("select key from concierge.app_settings where key <> all($1::text[]) order by key", [[...seeded.keys()]]);
    await db.query("commit");
    const keys = reset.rows.map((r) => r.key).sort();
    console.log(`db:clean: removed ${users.rowCount} test users; settings put back: ${keys.length ? keys.join(", ") : "none needed"}`);
    if (unknown.rowCount) console.log(`db:clean: left alone, not in this checkout's migrations: ${unknown.rows.map((r) => r.key).join(", ")}`);
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

function dbUrl() {
  // supabase/config.toml [db] port, the same fixed local database every checkout uses.
  const port = readFileSync(path.join(supabaseDir, "config.toml"), "utf8").match(/\[db\][^[]*?\nport\s*=\s*(\d+)/)?.[1];
  if (!port) throw new Error("No [db] port in supabase/config.toml");
  return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}

const command = process.argv.slice(2);
const db = new pg.Client({ connectionString: dbUrl(), keepAlive: true, connectionTimeoutMillis: 3000 });
// If the database goes away mid-run, the lock went with it; say so rather than crash under the command.
db.on("error", (e) => console.log(`db:clean: lost the local database connection, and with it the lock (${e.message})`));
let locked = false;
try {
  await db.connect();
  locked = true;
} catch (e) {
  // Locally a stopped stack just means the local-db tests skip; CI must have it running.
  if (!command.length || process.env.CI) throw e;
  console.log("db:clean: the local database isn't running, so no lock and no clean (pnpm supabase start)");
}

if (locked) {
  if (!(await db.query(`select pg_try_advisory_lock(${LOCK_KEY}) as got`)).rows[0].got) {
    console.log("db:clean: waiting for another test run on the local database to finish...");
    await db.query(`select pg_advisory_lock(${LOCK_KEY})`);
    console.log("db:clean: our turn");
  }
  await clean(db);
}

let code = 0;
if (command.length) {
  // Ctrl-C reaches the command too; wait for it to stop, then let go of the lock.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => {});
  // Through the shell so pnpm.cmd and supabase.cmd resolve on Windows; an argument with spaces stays one.
  const line = command.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
  const child = spawn(line, { stdio: "inherit", shell: true, cwd: root });
  code = await new Promise((resolve) => {
    child.on("exit", (c, signal) => resolve(c ?? (signal ? 1 : 0)));
    child.on("error", () => resolve(1));
  });
}
if (locked) await db.end();
process.exit(code);
