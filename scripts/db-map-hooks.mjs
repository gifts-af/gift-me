// Claude Code hooks that keep the database map's page current (CLAUDE.md > The database map page).
// The map itself is checked in CI (`pnpm db:map:check`); these make sure a changed map gets published.
//
//   merged     PostToolUse on `gh pr merge`: if the merged PR changed design/database-map.html, leave a
//              .db-map-pending note and tell Claude to publish it once the migrate job is green.
//   published  PostToolUse on Artifact: a publish to the map's page clears the note.
//   stop       Stop: while the note is there, block the first attempt to finish and say why.
//
// Any failure here (no gh, no network) stays silent: a hook must never break the session.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAP_PAGE = "https://claude.ai/artifact/9uCRGGJL5Tu4X53VCYV3Rk";
const MAP_ID = "9uCRGGJL5Tu4X53VCYV3Rk";
// DB_MAP_FILE only lets a pipe test point the hook at a file an existing PR changed.
const MAP_FILE = process.env.DB_MAP_FILE || "design/database-map.html";
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const NOTE = path.join(root, ".db-map-pending");
const mode = process.argv[2];

function readInput() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}
const say = (obj) => process.stdout.write(JSON.stringify(obj));

/** The PR a `gh pr merge` command merged: the number in the command, or the current branch's PR. */
export function prNumberFrom(command) {
  const m = /\bgh\s+pr\s+merge\s+(?:[^|;&]*?\s)?#?(\d+)\b/.exec(command);
  return m ? m[1] : null;
}

/** The published page's id, from an Artifact tool call's input. */
export function publishesMap(toolInput) {
  return typeof toolInput?.url === "string" && toolInput.url.includes(MAP_ID);
}

function mergedPr(command) {
  const gh = (args) => JSON.parse(execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }));
  const n = prNumberFrom(command);
  const pr = gh(["pr", "view", ...(n ? [n] : []), "--json", "number,state,files"]);
  return pr.state === "MERGED" ? pr : null;
}

function main() {
  const input = readInput();
  if (mode === "merged") {
    const command = input.tool_input?.command ?? "";
    if (!/\bgh\s+pr\s+merge\b/.test(command)) return;
    let pr;
    try {
      pr = mergedPr(command);
    } catch {
      return;
    }
    if (!pr || !pr.files.some((f) => f.path === MAP_FILE)) return;
    writeFileSync(NOTE, `PR #${pr.number} changed ${MAP_FILE}\n`);
    say({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          `PR #${pr.number} changed the database schema, so its map changed (${MAP_FILE}). Publish it before you finish: ` +
          `wait for CI's migrate job on main to pass (gh run list --workflow CI --branch main), pull main, then publish ` +
          `${MAP_FILE} from the main checkout with the Artifact tool, url ${MAP_PAGE}. Never publish a copy. ` +
          `If the migrate job failed, don't publish: fix the migration first.`,
      },
    });
  } else if (mode === "published") {
    if (!publishesMap(input.tool_input)) return;
    if (existsSync(NOTE)) rmSync(NOTE);
  } else if (mode === "stop") {
    if (!existsSync(NOTE) || input.stop_hook_active) return;
    say({
      decision: "block",
      reason:
        `The database map changed (${readFileSync(NOTE, "utf8").trim()}) and its page isn't published yet. ` +
        `Once CI's migrate job on main passes, publish ${MAP_FILE} from the main checkout to ${MAP_PAGE} with the Artifact tool. ` +
        `If you can't now, tell the user it's still to do; the note in .db-map-pending stays until it's published.`,
    });
  }
}

if (process.argv[1]?.endsWith("db-map-hooks.mjs")) {
  try {
    main();
  } catch {
    // never break the session
  }
}
