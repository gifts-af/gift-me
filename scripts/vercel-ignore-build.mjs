#!/usr/bin/env node
// Vercel's "Ignored Build Step" (apps/web/vercel.json > ignoreCommand).
// Skips a deploy when every file changed since the last deployed commit is
// documentation, so docs pushes don't use up Function Storage (each build stores
// a full copy of the app). Vercel's rule: exit 0 skips the build, exit 1 builds.
// When in doubt it builds.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Folders (from the repo root) that never reach the deployed app, plus Markdown
// outside apps/ and packages/.
const NOT_DEPLOYED = [
  "design/",
  "planning/",
  ".claude/",
  ".superpowers/",
  ".github/",
];

const isDocs = (file) =>
  NOT_DEPLOYED.some((dir) => file.startsWith(dir)) ||
  (file.endsWith(".md") &&
    !file.startsWith("apps/") &&
    !file.startsWith("packages/"));

/** @param {string[] | null} files changed paths from the repo root, or null if unknown */
export function decide(files) {
  if (!files || files.length === 0)
    return { action: "build", reason: "can't tell what changed" };
  const other = files.find((f) => !isDocs(f));
  if (other) return { action: "build", reason: `${other} changed` };
  return {
    action: "skip",
    reason: `only docs changed (${files.length} files)`,
  };
}

/**
 * Files changed between `prev` and HEAD, from the repo root, or null if unknown.
 * --no-renames lists a moved file under its old path too, so moving code out of
 * the app into a docs folder still builds.
 * @param {string | undefined} prev
 * @param {string} [cwd]
 */
export function changedFiles(prev, cwd) {
  if (!prev) return null;
  try {
    const out = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", prev, "HEAD"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return null; // the earlier commit isn't in Vercel's shallow clone
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { action, reason } = decide(
    changedFiles(process.env.VERCEL_GIT_PREVIOUS_SHA),
  );
  console.log(`${action === "skip" ? "Skipping" : "Building"}: ${reason}`);
  process.exit(action === "skip" ? 0 : 1);
}
