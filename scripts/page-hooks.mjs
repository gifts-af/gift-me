// Claude Code hooks that keep the shared pages drawn from repo files current: the database map
// (CLAUDE.md > The database map page) and the round engine page (CLAUDE.md > The round engine page).
// CI checks each file in the PR (`pnpm db:map:check`, `pnpm round-page:check`); these make sure a
// changed file gets published after the merge.
//
//   merged     PostToolUse on `gh pr merge`: for each page whose file the merged PR changed, leave
//              its pending note and tell Claude to publish it.
//   published  PostToolUse on Artifact: a publish to a page clears its note.
//   stop       Stop: while any note is there, block the first attempt to finish and say why.
//
// Any failure here (no gh, no network) stays silent: a hook must never break the session.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

export const PAGES = [
  {
    name: "database map",
    id: "9uCRGGJL5Tu4X53VCYV3Rk",
    // DB_MAP_FILE only lets a pipe test point the hook at a file an existing PR changed.
    file: process.env.DB_MAP_FILE || "design/database-map.html",
    note: ".db-map-pending",
    // The map shows the schema prod has only once the migration has run there.
    when: "wait for CI's migrate job on main to pass (gh run list --workflow CI --branch main), pull main, then publish",
    ifFailed: " If the migrate job failed, don't publish: fix the migration first.",
  },
  {
    name: "round engine page",
    id: "Edr5DRi5s53iRPfAsuSnd8",
    file: "design/round-engine.html",
    note: ".round-page-pending",
    when: "pull main, then publish",
    ifFailed: "",
  },
];
const pageUrl = (p) => `https://claude.ai/artifact/${p.id}`;
const notePath = (p) => path.join(root, p.note);

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

/** The page an Artifact tool call publishes to, if it's one of ours. */
export function pagePublished(toolInput) {
  const url = typeof toolInput?.url === "string" ? toolInput.url : "";
  return PAGES.find((p) => url.includes(p.id)) ?? null;
}

function mergedPr(command) {
  const gh = (args) => JSON.parse(execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }));
  const n = prNumberFrom(command);
  const pr = gh(["pr", "view", ...(n ? [n] : []), "--json", "number,state,files"]);
  return pr.state === "MERGED" ? pr : null;
}

function main(mode) {
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
    if (!pr) return;
    const changed = PAGES.filter((p) => pr.files.some((f) => f.path === p.file));
    if (changed.length === 0) return;
    for (const p of changed) writeFileSync(notePath(p), `PR #${pr.number} changed ${p.file}\n`);
    say({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: changed
          .map(
            (p) =>
              `PR #${pr.number} changed the ${p.name} (${p.file}). Publish it before you finish: ${p.when} ` +
              `${p.file} from the main checkout with the Artifact tool, url ${pageUrl(p)}. Never publish a copy.${p.ifFailed}`,
          )
          .join("\n"),
      },
    });
  } else if (mode === "published") {
    const p = pagePublished(input.tool_input);
    if (p && existsSync(notePath(p))) rmSync(notePath(p));
  } else if (mode === "stop") {
    if (input.stop_hook_active) return;
    const pending = PAGES.filter((p) => existsSync(notePath(p)));
    if (pending.length === 0) return;
    say({
      decision: "block",
      reason: pending
        .map(
          (p) =>
            `The ${p.name} changed (${readFileSync(notePath(p), "utf8").trim()}) and its page isn't published yet. ` +
            `${p.when[0].toUpperCase()}${p.when.slice(1)} ${p.file} from the main checkout to ${pageUrl(p)} with the Artifact tool. ` +
            `If you can't now, tell the user it's still to do; the note in ${p.note} stays until it's published.`,
        )
        .join("\n"),
    });
  }
}

if (process.argv[1]?.endsWith("page-hooks.mjs")) {
  try {
    main(process.argv[2]);
  } catch {
    // never break the session
  }
}
