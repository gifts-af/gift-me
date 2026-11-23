// The code columns' CHECK lists (20261123100200_code_column_checks.sql) against the app's own
// lists, read from the real local database (E4, E5). A value the app writes that the database
// refuses fails here, not as a failed insert in production; a value the database allows that
// the app has dropped fails here too. Skipped when the local stack isn't running; fails in CI then.
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { RejectionCode } from "@gifts-af/core";
import { LOCAL_DB, localStack } from "@/test/local-db";
import type { RunEnd, RunStage } from "@/modules/concierge/ideas/store";

// Next's guard that keeps server modules out of browser code; not something of ours.
vi.mock("server-only", () => ({}));

const stack = await localStack({ api: false });

// Lists that exist only as types. Each is checked against its type at compile time (pnpm
// typecheck), so a value added to the type and not here fails there.
const RUN_STAGES = ["brainstormed", "resolved", "ranked"] as const; // ideas/store.ts RunStage
expectTypeOf<(typeof RUN_STAGES)[number]>().toEqualTypeOf<RunStage>();
const REJECTION_CODES = ["has_it", "not_style", "too_pricey", "too_generic"] as const; // core approval.ts RejectionCode
expectTypeOf<(typeof REJECTION_CODES)[number]>().toEqualTypeOf<RejectionCode>();

/** The quoted values in a constraint's definition, e.g. CHECK ((kind = ANY (ARRAY['a'::text, ...]))). */
async function allowed(pg: Client, constraint: string): Promise<string[]> {
  const { rows } = await pg.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1", [constraint]);
  if (rows.length !== 1) throw new Error(`expected one constraint named ${constraint}, found ${rows.length}`);
  return [...rows[0].def.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe.skipIf(!stack)("code column CHECK lists match the app (real local database)", () => {
  let pg: Client;

  beforeAll(async () => {
    pg = new Client({ connectionString: LOCAL_DB });
    await pg.connect();
  });
  afterAll(async () => {
    await pg.end();
  });

  it("notifications.kind allows exactly the notification kinds (notify/templates.ts)", async () => {
    const { TEMPLATES } = await import("@/modules/concierge/notify/templates");
    expect(await allowed(pg, "notifications_kind_check")).toEqual(sorted(Object.keys(TEMPLATES)));
  });

  it("action_links.action allows exactly the link actions (notify/actions.ts)", async () => {
    const { ACTIONS } = await import("@/modules/concierge/notify/actions");
    expect(await allowed(pg, "action_links_action_check")).toEqual(sorted(Object.keys(ACTIONS)));
  });

  it("list_items.source allows exactly the sources a save keeps (lists lib/save-list.ts)", async () => {
    const { LIST_ITEM_SOURCES } = await import("@/modules/lists");
    expect(await allowed(pg, "list_items_source_check")).toEqual(sorted(LIST_ITEM_SOURCES));
  });

  it("captures and inbound messages allow exactly the image types the app accepts", async () => {
    const { IMAGE_EXTENSIONS } = await import("@/modules/concierge/capture/capture");
    const { IMAGE_TYPES } = await import("@/modules/concierge/inbound/parse");
    // An emailed note's image becomes its capture's screenshot, so the two lists must agree.
    expect(sorted(IMAGE_TYPES)).toEqual(sorted(Object.keys(IMAGE_EXTENSIONS)));
    expect(await allowed(pg, "captures_screenshot_type_check")).toEqual(sorted(Object.keys(IMAGE_EXTENSIONS)));
    expect(await allowed(pg, "inbound_messages_image_type_check")).toEqual(sorted(IMAGE_TYPES));
  });

  it("idea_runs.stage allows exactly the run stages", async () => {
    expect(await allowed(pg, "idea_runs_stage_check")).toEqual(sorted(RUN_STAGES));
  });

  it("idea_runs.outcome allows exactly the run ends", async () => {
    const { RUN_ENDS } = await import("@/modules/concierge/ideas/store");
    expectTypeOf<(typeof RUN_ENDS)[number]>().toEqualTypeOf<RunEnd>();
    expect(await allowed(pg, "idea_runs_outcome_check")).toEqual(sorted(RUN_ENDS));
  });

  it("rejections.reason_code allows exactly the rejection codes", async () => {
    expect(await allowed(pg, "rejections_reason_code_check")).toEqual(sorted(REJECTION_CODES));
  });

  it("orders.failure_type allows every failure type the app and SQL write", async () => {
    const { failureType } = await import("@/modules/concierge/zinc/events");
    // No single list: each writer is named. A new writer adds its values here.
    const written = new Set([
      // zinc/events.ts failureType: Zinc's error types mapped, anything else plain "failed".
      ...["max_price_exceeded", "out_of_stock", "invalid_shipping_address", "something_else", undefined].map(failureType),
      // purchase/place.ts: placing's own checks before calling Zinc.
      "failed",
      "too_late",
      "address_withdrawn",
      // SQL fail_order_row (20261113100000_order_address_source.sql): a shared address the store refused.
      "address_rejected",
      // SQL round closing around a held gift (20261114100000_every_failure_told.sql).
      "held_expired",
      "cancelled",
      "round_closed",
    ]);
    const db = await allowed(pg, "orders_failure_type_check");
    expect(sorted(written).filter((v) => !db.includes(v))).toEqual([]);
  });
});
