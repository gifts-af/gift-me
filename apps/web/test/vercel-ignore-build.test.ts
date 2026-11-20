import { describe, expect, it } from "vitest";
import { decide } from "../../../scripts/vercel-ignore-build.mjs";

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
