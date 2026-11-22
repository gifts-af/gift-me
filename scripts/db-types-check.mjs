// Fails when packages/core/src/database.types.ts doesn't match the local
// database's schema (pnpm db:types:check). Run with the local Supabase up and
// every migration applied; CI's db job does this after its database tests.
import { execFileSync } from "node:child_process";

const TYPES = "packages/core/src/database.types.ts";
const shell = process.platform === "win32";

execFileSync("pnpm", ["db:types"], { stdio: "inherit", shell });
try {
  execFileSync("git", ["diff", "--exit-code", "--", TYPES], { stdio: "inherit" });
} catch {
  console.error(`\n${TYPES} is out of date. Run 'pnpm db:types' and commit it.`);
  process.exit(1);
}
