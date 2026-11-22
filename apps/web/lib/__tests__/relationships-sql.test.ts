import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RELATIONSHIPS } from "@gifts-af/core";

// The database checks relationships against its own copy of the list
// (public.is_relationship). Base budgets are matched on the stored key, so the
// two lists must stay identical; this reads the latest migration that defines
// the function and compares.
const migrations = fileURLToPath(new URL("../../../../supabase/migrations", import.meta.url));

function sqlRelationships(): string[] {
  const latest = readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migrations, f), "utf8"))
    .filter((sql) => /create or replace function public\.is_relationship\b/i.test(sql))
    .at(-1);
  if (!latest) throw new Error("no migration defines public.is_relationship");
  const body = latest.match(/function public\.is_relationship[\s\S]*?array\[([\s\S]*?)\]/i);
  if (!body) throw new Error("public.is_relationship has no array[...] list");
  return [...body[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("relationships in the database", () => {
  it("allows exactly the relationships the app offers", () => {
    expect(sqlRelationships()).toEqual([...RELATIONSHIPS]);
  });
});
