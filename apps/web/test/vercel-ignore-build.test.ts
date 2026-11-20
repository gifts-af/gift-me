import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedFiles, decide } from "../../../scripts/vercel-ignore-build.mjs";

// Vercel's Ignored Build Step: "skip" exits 0 (no build), "build" exits 1.
describe("vercel-ignore-build decide", () => {
  it("skips a push that only changes docs", () => {
    expect(
      decide(["design/ui.md", "planning/strategy.md", "README.md"]).action,
    ).toBe("skip");
  });

  it("skips Claude, plan-workspace and GitHub-only changes", () => {
    expect(
      decide([
        ".claude/settings.json",
        ".superpowers/x.txt",
        ".github/workflows/ci.yml",
      ]).action,
    ).toBe("skip");
  });

  it("builds when any app, package or database file changes", () => {
    expect(decide(["design/ui.md", "apps/web/app/page.tsx"]).action).toBe(
      "build",
    );
    expect(decide(["packages/core/src/index.ts"]).action).toBe("build");
    expect(decide(["supabase/migrations/1_x.sql"]).action).toBe("build");
    expect(decide(["pnpm-lock.yaml"]).action).toBe("build");
  });

  it("builds when a docs-named folder sits inside the app", () => {
    expect(decide(["apps/web/design/thing.ts"]).action).toBe("build");
  });

  it("builds when it can't tell what changed", () => {
    expect(decide(null).action).toBe("build");
    expect(decide([]).action).toBe("build");
  });
});

describe("vercel-ignore-build changedFiles", () => {
  it("lists a file moved out of the app under both paths, so it builds", () => {
    const dir = mkdtempSync(join(tmpdir(), "ignore-build-"));
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
        { cwd: dir, encoding: "utf8" },
      );
    try {
      git("init", "-q");
      mkdirSync(join(dir, "apps/web"), { recursive: true });
      mkdirSync(join(dir, "design"));
      writeFileSync(
        join(dir, "apps/web/x.ts"),
        "export const x = 1;\n".repeat(20),
      );
      git("add", "-A");
      git("commit", "-qm", "one");
      const prev = git("rev-parse", "HEAD").trim();
      git("mv", "apps/web/x.ts", "design/x.ts");
      git("commit", "-qm", "two");

      const files = changedFiles(prev, dir);
      expect(files).toEqual(
        expect.arrayContaining(["apps/web/x.ts", "design/x.ts"]),
      );
      expect(decide(files).action).toBe("build");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
