// Run: node --test scripts/round-page-check.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { flowReasons, hasNoChangeLine, sectionRanges, touchedSections } from "./round-page-check.mjs";

const DOC = [
  "# Doc", // 1
  "### 4.1 Ship-by deadline and schedule", // 2
  "text", // 3
  "### 4.2 Budget", // 4
  "text", // 5
  "## 5. Gift round statuses", // 6
  "text", // 7
  "### 5.1 Round engine (T8, T49)", // 8
  "text", // 9
  "## 6. Key flows", // 10
  "text", // 11
].join("\n");

test("sectionRanges finds 4.1 and 5 (with 5.1) by heading", () => {
  assert.deepEqual(sectionRanges(DOC), [
    [2, 3],
    [6, 9],
  ]);
});

test("touchedSections is true only for changed lines inside those sections", () => {
  assert.equal(touchedSections(DOC, [5, 11]), false);
  assert.equal(touchedSections(DOC, [3]), true);
  assert.equal(touchedSections(DOC, [9]), true);
});

test("round code, routes and core schedule files count; tests don't", () => {
  const r = flowReasons({
    files: [
      "apps/web/modules/concierge/rounds/steps.ts",
      "apps/web/modules/concierge/rounds/__tests__/steps.test.ts",
      "apps/web/app/api/rounds/tick/route.ts",
      "packages/core/src/schedule.ts",
      "packages/core/src/schedule.test.ts",
      "apps/web/modules/concierge/lists/store.ts",
    ],
  });
  assert.deepEqual(r, [
    "apps/web/modules/concierge/rounds/steps.ts",
    "apps/web/app/api/rounds/tick/route.ts",
    "packages/core/src/schedule.ts",
  ]);
});

test("a migration counts only when its added lines touch rounds", () => {
  const files = ["supabase/migrations/1_a.sql", "supabase/migrations/2_b.sql"];
  const added = {
    "supabase/migrations/1_a.sql": "create or replace function concierge.reconcile_round(p uuid)",
    "supabase/migrations/2_b.sql": "alter table lists.items add column note text;",
  };
  assert.deepEqual(flowReasons({ files, added }), ["supabase/migrations/1_a.sql"]);
});

test("the design doc counts when its round sections changed", () => {
  const files = ["design/technical-design.md"];
  assert.deepEqual(flowReasons({ files, docTouched: true }), ["design/technical-design.md (§4.1, §5, §5.1)"]);
  assert.deepEqual(flowReasons({ files, docTouched: false }), []);
});

test("code that moves an order's status counts too", () => {
  const files = [
    "apps/web/modules/concierge/tracking/arrived.ts",
    "apps/web/modules/concierge/purchase/store.ts",
    "apps/web/modules/concierge/zinc/events.ts",
    "apps/web/modules/concierge/zinc/tracking-events.ts",
  ];
  assert.deepEqual(flowReasons({ files }), files);
});

test("vercel.json counts only when its round lines changed", () => {
  const files = ["apps/web/vercel.json"];
  const added = { "apps/web/vercel.json": '    { "path": "/api/rounds/tick", "schedule": "0 11 * * *" }' };
  assert.deepEqual(flowReasons({ files, added }), ["apps/web/vercel.json"]);
  assert.deepEqual(flowReasons({ files, added: { "apps/web/vercel.json": '"framework": "nextjs"' } }), []);
});

test("hasNoChangeLine needs the phrase and a reason", () => {
  assert.equal(hasNoChangeLine("Round engine page: no change, only a log field renamed"), true);
  assert.equal(hasNoChangeLine("Summary\n\nround engine page: no change (test-only refactor)\n"), true);
  assert.equal(hasNoChangeLine("Round engine page: no change"), false);
  assert.equal(hasNoChangeLine(""), false);
  assert.equal(hasNoChangeLine(null), false);
  // The reason must be on the same line, and the template's placeholder isn't one.
  assert.equal(hasNoChangeLine("Round engine page: no change\nNext paragraph"), false);
  assert.equal(hasNoChangeLine("Round engine page: no change, <why>"), false);
});
