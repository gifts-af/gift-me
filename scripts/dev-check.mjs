#!/usr/bin/env node
// Checks that this machine has what local development needs.
//
//   pnpm dev:check   full report with fix steps (exit code 1 if something required is missing)
//   --hook           used by Claude Code's SessionStart hook (.claude/settings.json): prints
//                    nothing when all is well, otherwise tells Claude what to walk the person
//                    through. Always exits 0 so a session is never blocked.
//
// When a new tool becomes required, add a check here and a row to "Local development" in README.md.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hookMode = process.argv.includes("--hook");
const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";

function run(cmd, args, timeout = 8000) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout, shell: process.platform === "win32" });
  return { ok: r.status === 0, out: (r.stdout || "").trim() };
}

const docker = run("docker", ["--version"]);
const dockerRunning = docker.ok && run("docker", ["info", "--format", "{{.ServerVersion}}"], 10000).ok;
const nodeMajor = Number(process.versions.node.split(".")[0]);
const supabaseBin = join(root, "node_modules", ".bin", process.platform === "win32" ? "supabase.cmd" : "supabase");

// Each check: required ones block local development; the rest are reminders.
const checks = [
  {
    name: "Node 22+",
    ok: nodeMajor >= 22,
    fix: {
      windows: "winget install -e --id OpenJS.NodeJS.LTS",
      mac: "brew install node@22 (or use nvm)",
      linux: "Install Node 22+ from https://nodejs.org or with nvm",
    },
  },
  {
    name: "pnpm",
    ok: run("pnpm", ["--version"]).ok,
    fix: { all: "npm install -g pnpm" },
  },
  {
    name: "Dependencies installed (includes the Supabase CLI)",
    ok: existsSync(supabaseBin),
    fix: { all: "pnpm install (from the repo root)" },
  },
  {
    name: "Docker installed",
    ok: docker.ok,
    fix: {
      windows:
        "wsl --install --no-distribution (admin, then restart Windows), then winget install -e --id Docker.DockerDesktop",
      mac: "brew install --cask docker (or download Docker Desktop from docker.com)",
      linux: "Install Docker Engine: https://docs.docker.com/engine/install/",
    },
  },
  {
    name: "Docker running",
    ok: dockerRunning,
    skipIf: !docker.ok,
    fix: {
      windows: "Start Docker Desktop and wait until it says Engine running",
      mac: "Start Docker Desktop and wait until it says Engine running",
      linux: "sudo systemctl start docker",
    },
  },
  {
    name: "Web app environment file (apps/web/.env.development.local)",
    ok: existsSync(join(root, "apps", "web", ".env.development.local")),
    optional: true,
    fix: { all: "See apps/web/README.md, step 2 (vercel env pull)" },
  },
].filter((c) => !c.skipIf);

const failing = checks.filter((c) => !c.ok);
const fixFor = (c) => c.fix.all ?? c.fix[os];

if (hookMode) {
  const required = failing.filter((c) => !c.optional);
  if (required.length) {
    console.log(
      [
        "LOCAL DEV SETUP IS INCOMPLETE on this machine (from scripts/dev-check.mjs).",
        "Before starting other work, tell the person what is missing and offer to walk them through it,",
        "one step at a time, following README.md > Local development. Missing:",
        ...required.map((c) => `- ${c.name}: ${fixFor(c)}`),
        "Re-run `pnpm dev:check` to confirm when done.",
      ].join("\n"),
    );
  }
  process.exit(0);
}

console.log(`Local dev check (${os})\n`);
for (const c of checks) {
  const mark = c.ok ? "ok  " : c.optional ? "note" : "MISS";
  console.log(`  [${mark}] ${c.name}`);
  if (!c.ok) console.log(`         fix: ${fixFor(c)}`);
}
const blocking = failing.filter((c) => !c.optional).length;
console.log(
  blocking
    ? `\n${blocking} required item(s) missing. Details: README.md > Local development.`
    : "\nAll set. Start the local database with: pnpm supabase start",
);
process.exit(blocking ? 1 : 0);
