// Every health email line links to a runbook heading in design/operations.md; a renamed heading
// would break the link silently, so the anchors are checked against the doc itself.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUNBOOK_ANCHORS } from "../health/email";

const OPERATIONS = path.resolve(__dirname, "../../../../../design/operations.md");

/** The anchors GitHub gives a Markdown file's headings, a repeat getting -1, -2 and so on. */
function headingSlugs(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const slugs = new Set<string>();
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = m[1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

describe("health runbooks", () => {
  it("builds GitHub's slugs", () => {
    expect([...headingSlugs("## The database can't be reached\n```\n# not a heading\n```\n### `ideas.run` events\n## AI credit\n## AI credit")]).toEqual([
      "the-database-cant-be-reached",
      "ideasrun-events",
      "ai-credit",
      "ai-credit-1",
    ]);
  });

  it("every RUNBOOK_ANCHORS anchor is a heading in operations.md", () => {
    const slugs = headingSlugs(readFileSync(OPERATIONS, "utf8"));
    const missing = [...new Set(Object.values(RUNBOOK_ANCHORS))].filter((a) => !slugs.has(a));
    expect(missing).toEqual([]);
  });
});
