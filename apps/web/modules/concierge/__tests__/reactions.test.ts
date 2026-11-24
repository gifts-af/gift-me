import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Database } from "@gifts-af/core";
import { hasPastGifts, reactionView, saveReaction } from "../reactions/reactions";

vi.mock("server-only", () => ({}));

// What saveReaction and the reads do with the database's refusals and failures, which the real one
// can't be made to give on demand. reactions-db.test.ts runs the same functions on the real database.

const ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-03-01T23:30:00Z");
const ORDER = { round_id: "r1", gift_rounds: { person_id: "p1" }, gift_ideas: { title: "Fly rod", source: "generated" } };
type Reply = { data: unknown; error: { message: string; code?: string } | null };

/** A client whose every query answers `rows`, and whose rpc answers `replies` in turn. Keeps what was asked. */
function fake(rows: Reply, replies: Reply[] = []) {
  const asked: unknown[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>): Promise<Reply> => {
    asked.push(name, args);
    return replies.shift() ?? { data: null, error: { message: "no reply" } };
  });
  const query: object = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === "then") return (done: (r: Reply) => void) => done(rows);
        return (...args: unknown[]) => {
          asked.push(args);
          return query;
        };
      },
    },
  );
  const from = (table: string) => {
    asked.push(table);
    return query;
  };
  const db = { schema: () => ({ rpc, from }), from } as unknown as SupabaseClient<Database>;
  return { rpc, asked, db };
}
const refused = (message: string, code = "P0001"): Reply => ({ data: null, error: { message, code } });
const found: Reply = { data: ORDER, error: null };

let log: MockInstance;
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

const save = (f: ReturnType<typeof fake>, note: string | null = null) =>
  saveReaction({ userId: "u1", orderId: ID, rating: "loved", note }, { db: f.db, now: NOW });

describe("saveReaction", () => {
  it("sends the trimmed note, the fact and the UTC day", async () => {
    const f = fake(found, [{ data: "complete", error: null }]);
    expect(await save(f, " nice ")).toEqual({ ok: true, roundId: "r1", personId: "p1", complete: true });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("save_reaction", {
      p_user_id: "u1",
      p_order_id: ID,
      p_rating: "loved",
      p_note: "nice",
      p_fact_category: "loved",
      p_fact_value: "Fly rod: nice",
      p_today: "2026-03-01",
    });
  });

  it.each([
    ["off", "off"],
    ["note too long", "note_too_long"],
    ["not found", "not_found"],
    ["not delivered", "not_delivered"],
    ["before the occasion", "too_early"],
    ["bad rating", "failed"],
    ["bad fact", "failed"],
    ["missing setting reactions_enabled", "failed"],
  ])("maps the refusal '%s' to %s, in plain words", async (message, reason) => {
    const result = await save(fake(found, [refused(`save_reaction: ${message}`)]));
    expect(result).toMatchObject({ ok: false, reason });
    expect(result).not.toMatchObject({ error: expect.stringMatching(/save_reaction|setting/) });
  });

  it("says Not available right now when switched off (AC-13)", async () => {
    expect(await save(fake(found, [refused("save_reaction: off")]))).toMatchObject({ error: "Not available right now." });
  });

  it("tries a deadlock once more, and only once", async () => {
    const deadlock = refused("deadlock detected", "40P01");
    expect(await save(fake(found, [deadlock, { data: "delivered", error: null }]))).toMatchObject({ ok: true, complete: false });
    const twice = fake(found, [deadlock, deadlock, { data: "delivered", error: null }]);
    expect(await save(twice)).toMatchObject({ ok: false, reason: "failed" });
    expect(twice.rpc).toHaveBeenCalledTimes(2);
  });

  it("anything else is the plain fallback, not tried again", async () => {
    const f = fake(found, [refused("check", "23514")]);
    expect(await save(f)).toMatchObject({ ok: false, reason: "failed" });
    expect(f.rpc).toHaveBeenCalledTimes(1);
    const unread = fake(refused("down", "XX000"));
    expect(await save(unread)).toMatchObject({ ok: false, reason: "failed" });
    expect(unread.rpc).not.toHaveBeenCalled();
  });

  it("logs ids only, never the title or note (E6)", async () => {
    await save(fake(found, [{ data: "complete", error: null }]), "lovely thing");
    await save(fake(found, [refused("row has Fly rod: lovely thing")]), "lovely thing");
    await save(fake(found), "her diabetes");
    const lines = log.mock.calls.flat().join("\n");
    expect(lines).toContain("reaction.saved");
    expect(lines).toContain("reaction.save_failed");
    expect(lines).toContain("reaction.refused");
    expect(lines).not.toMatch(/Fly rod|lovely|diabetes/);
  });
});

describe("hasPastGifts", () => {
  it("is false on an error and on a throw, and logs it (AC-19)", async () => {
    expect(await hasPastGifts(ID, fake(refused("down", "XX000")).db, NOW)).toBe(false);
    const throws = {
      schema: () => {
        throw new Error("down");
      },
    } as unknown as SupabaseClient<Database>;
    expect(await hasPastGifts(ID, throws, NOW)).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("needs the reactions switch to exist, whatever its value: without it the history can't be read (AC-19)", async () => {
    const some: Reply = { data: [{ id: ID }], error: null };
    for (const value of [1, 0]) expect(await hasPastGifts(ID, fake(some, [{ data: value, error: null }]).db, NOW)).toBe(true);
    expect(await hasPastGifts(ID, fake(some, [{ data: null, error: null }]).db, NOW)).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(await hasPastGifts(ID, fake(some, [refused("down", "XX000")]).db, NOW)).toBe(false);
  });

  it("never reads the reactions table (AC-19)", async () => {
    const f = fake({ data: [], error: null }, [{ data: 1, error: null }]);
    expect(await hasPastGifts(ID, f.db, NOW)).toBe(false);
    expect(JSON.stringify(f.asked)).toContain("gift_rounds");
    expect(f.asked).not.toContain("reactions");
    expect(JSON.stringify(f.asked)).not.toContain("reactions(");
  });
});

describe("reactionView", () => {
  const round: Reply = { data: { id: ID, person_id: "p1", occasion_date: "2026-02-01", status: "delivered", occasions: null, orders: [] }, error: null };

  it("says answering is off when the switch is, or is missing (AC-13)", async () => {
    for (const value of [0, null]) {
      const f = fake(round);
      f.rpc.mockImplementation(async (_name, args) => ({ data: args.p_key === "reactions_enabled" ? value : 500, error: null }));
      expect((await reactionView(ID, f.db, NOW))?.closed).toBe("off");
    }
  });
});
