// Fails a PR that changes how a gift round moves without updating the round engine page
// (CLAUDE.md > The round engine page). The page is hand-drawn, so unlike the database map it
// can't be generated; this only makes sure someone decided whether it needed a change.
//
// The round flow counts as changed when the PR touches round code, the tick and job routes,
// the code that moves an order's status, the schedule math in packages/core, the tick's
// schedule in vercel.json, a migration about rounds, or design/technical-design.md §4.1, §5 or
// §5.1 (the sections the page draws). Tests alone don't count. The doc's sections are found by
// heading, so renaming "### 4.1" or "## 5." means updating SECTIONS.
//
// Passes when design/round-engine.html changed too, or the PR body has a line like
// "Round engine page: no change, <why>".
//
// Inputs (all optional locally): BASE_SHA (default origin/main), HEAD_SHA (default HEAD),
// PR_BODY (default: the current branch's PR body, through gh).
import { execFileSync } from "node:child_process";

const PAGE_FILE = "design/round-engine.html";
const DOC_FILE = "design/technical-design.md";
const CODE_PREFIXES = ["apps/web/modules/concierge/rounds/", "apps/web/app/api/rounds/"];
const FILES = [
  "packages/core/src/rounds.ts",
  "packages/core/src/round-plan.ts",
  "packages/core/src/schedule.ts",
  // An order's status moves its round.
  "apps/web/modules/concierge/tracking/arrived.ts",
  "apps/web/modules/concierge/purchase/store.ts",
  "apps/web/modules/concierge/zinc/events.ts",
  "apps/web/modules/concierge/zinc/tracking-events.ts",
];
// Counts only when its added lines mention the round routes (the tick's schedule).
const VERCEL_JSON = "apps/web/vercel.json";
const ROUND_ROUTE = /\/api\/rounds\//;
const ROUND_SQL = /\b(gift_rounds|round_sends|reconcile_round|claim_round|tick_heartbeats|round_idea_state)\b/;
// The page draws §4.1 and §5 (which holds §5.1); each runs to the next heading at its level or above.
const SECTIONS = [/^### 4\.1 /, /^## 5\. /];

const isTest = (f) => f.includes("/__tests__/") || /\.test\.[cm]?[jt]sx?$/.test(f);

/** 1-based [first, last] line ranges of the sections the page draws, from the doc's headings. */
export function sectionRanges(doc) {
  const lines = doc.split("\n");
  const level = (l) => (/^(#+) /.exec(l) || [])[1]?.length ?? 0;
  const ranges = [];
  lines.forEach((line, i) => {
    if (!SECTIONS.some((re) => re.test(line))) return;
    const own = level(line);
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const l = level(lines[j]);
      if (l && l <= own) {
        end = j;
        break;
      }
    }
    ranges.push([i + 1, end]);
  });
  return ranges;
}

/** Whether any changed line number (in the new doc) falls inside a section the page draws. */
export function touchedSections(doc, changedLines) {
  const ranges = sectionRanges(doc);
  return changedLines.some((n) => ranges.some(([a, b]) => n >= a && n <= b));
}

/** The changes that count as the round flow changing, each named for the message. */
export function flowReasons({ files, added = {}, docTouched = false }) {
  const reasons = [];
  for (const f of files) {
    if (isTest(f)) continue;
    if (CODE_PREFIXES.some((p) => f.startsWith(p)) || FILES.includes(f)) reasons.push(f);
    else if (f.startsWith("supabase/migrations/") && ROUND_SQL.test(added[f] ?? "")) reasons.push(f);
    else if (f === VERCEL_JSON && ROUND_ROUTE.test(added[f] ?? "")) reasons.push(f);
    else if (f === DOC_FILE && docTouched) reasons.push(`${DOC_FILE} (§4.1, §5, §5.1)`);
  }
  return reasons;
}

/** The PR body's opt-out: the phrase plus a reason on the same line, not the template's "<why>". */
export function hasNoChangeLine(body) {
  return (body ?? "").split(/\r?\n/).some((line) => {
    const m = /round engine page:[ \t]*no change\b[ \t,.;:(—-]*(.*)$/i.exec(line);
    const why = (m?.[1] ?? "").replace(/[`)\s]+$/, "");
    return why.length > 0 && why !== "<why>";
  });
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** New-file line numbers of every added or changed line, from a zero-context diff. */
function changedLineNumbers(diff) {
  const out = [];
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    // A pure deletion (count 0) still changes the section it sat in.
    if (count === 0) out.push(start);
    for (let i = 0; i < count; i++) out.push(start + i);
  }
  return out;
}

function prBody() {
  if (process.env.PR_BODY !== undefined) return process.env.PR_BODY;
  try {
    return execFileSync("gh", ["pr", "view", "--json", "body", "-q", ".body"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function main() {
  const base = process.env.BASE_SHA || "origin/main";
  const head = process.env.HEAD_SHA || "HEAD";
  const range = `${base}...${head}`;
  const files = git(["diff", "--name-only", range]).split("\n").filter(Boolean);
  if (files.includes(PAGE_FILE)) {
    console.log(`Round engine page: ${PAGE_FILE} changed in this PR.`);
    return;
  }
  const added = {};
  for (const f of files.filter((x) => x.startsWith("supabase/migrations/") || x === VERCEL_JSON)) {
    added[f] = git(["diff", "-U0", range, "--", f])
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .join("\n");
  }
  let docTouched = false;
  if (files.includes(DOC_FILE)) {
    const doc = git(["show", `${head}:${DOC_FILE}`]);
    docTouched = touchedSections(doc, changedLineNumbers(git(["diff", "-U0", range, "--", DOC_FILE])));
  }
  const reasons = flowReasons({ files, added, docTouched });
  if (reasons.length === 0) {
    console.log("Round engine page: this PR doesn't change the round flow.");
    return;
  }
  if (hasNoChangeLine(prBody())) {
    console.log(`Round engine page: the PR says no change is needed (${reasons.length} round-flow file(s)).`);
    return;
  }
  console.error(
    [
      "This PR changes how a gift round moves, but not the round engine page:",
      ...reasons.map((r) => `  - ${r}`),
      "",
      `Either update ${PAGE_FILE} to match (CLAUDE.md > The round engine page),`,
      'or add a line to the PR body: "Round engine page: no change, <why>".',
    ].join("\n"),
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith("round-page-check.mjs")) main();
