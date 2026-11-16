// Applies new migrations to one hosted Supabase project:
//   node scripts/db-push.mjs <project-ref> [--dry-run]
// (pnpm db:push:dev / db:push:prod). Since 2026-11-16 GitHub's runners can't
// reach a project's direct database address (IPv6 only), and `db push
// --project-ref` uses it. A linked project goes through the IPv4 pooler, so this
// links a scratch copy of supabase/ and pushes from there. Your own checkout's
// link (dev, by habit) is never touched.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [ref, ...flags] = process.argv.slice(2);
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
  console.error("Usage: node scripts/db-push.mjs <project-ref> [--dry-run]");
  process.exit(1);
}

const workdir = mkdtempSync(join(tmpdir(), "db-push-"));
try {
  cpSync("supabase", join(workdir, "supabase"), { recursive: true });
  const supabase = (args) =>
    execFileSync("pnpm", ["exec", "supabase", ...args, "--workdir", workdir], { stdio: "inherit", shell: process.platform === "win32" });
  supabase(["link", "--project-ref", ref]);
  supabase(["db", "push", "--linked", "--yes", ...flags]);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
