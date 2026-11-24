import { describe, expect, it, vi } from "vitest";
import { runReactions } from "../reactions/ask";
import { runTick } from "../rounds/engine";
import { at, BASE, captureLog, events, harness, named, USER } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// Asking how the gifts went over, against fake stores. Which rounds are due and which close is
// SQL's (reactions.test.sql, reactions-ask-db.test.ts).

captureLog();

const DAY = "2027-03-21";

function setup(rounds: Record<string, string[]> = { r1: ["o1", "o2"] }) {
  const h = harness();
  for (const [roundId, orderIds] of Object.entries(rounds)) {
    h.store.reactionDue.push({ roundId, userId: USER });
    h.store.reactionAsks.set(roundId, {
      personName: "Nora",
      occasionKind: "birthday",
      occasionDate: "2027-03-20",
      gifts: orderIds.map((orderId) => ({ orderId, title: `Gift ${orderId}` })),
    });
  }
  h.today = DAY;
  const { store, notify, now } = h.deps(at(DAY));
  return Object.assign(h, {
    run: () => runReactions({ store, notify, now }),
    asked: (roundId = "r1") => h.store.sends.get(roundId)?.has("reaction_prompt") ?? false,
  });
}

describe("runReactions", () => {
  it("sends one email with four plain links per gift, records the key, and sends nothing twice", async () => {
    const h = setup();
    expect(await h.run()).toEqual({ closed: 0, asked: 1 });
    expect(h.emails).toHaveLength(1);
    for (const o of ["o1", "o2"])
      for (const r of ["loved", "liked", "meh", "returned"]) expect(h.emails[0].text).toContain(`: ${BASE}/rounds/r1/reaction?gift=${o}&r=${r}`);
    expect(h.notifyStore.links).toEqual([]);
    expect(h.asked()).toBe(true);
    expect(await h.run()).toEqual({ closed: 0, asked: 0 });
    expect(h.emails).toHaveLength(1);
  });

  it("two ticks at once send one email", async () => {
    const h = setup();
    const results = await Promise.all([h.run(), h.run()]);
    expect(results.map((r) => r.asked).sort()).toEqual([0, 1]);
    expect(h.emails).toHaveLength(1);
    expect(h.asked()).toBe(true);
  });

  it("closes first, with the tick's UTC day, and a closed round gets no email", async () => {
    const h = setup();
    const calls: string[] = [];
    vi.spyOn(h.store, "closeReactedRounds").mockImplementation(async (d) => {
      calls.push(`close ${d}`);
      h.store.reactionDue = [];
      return 2;
    });
    vi.spyOn(h.store, "reactionsDue").mockImplementation(async (d) => {
      calls.push(`due ${d}`);
      return h.store.reactionDue;
    });
    expect(await h.run()).toEqual({ closed: 2, asked: 0 });
    expect(calls).toEqual([`close ${DAY}`, `due ${DAY}`]);
    expect(h.emails).toEqual([]);
  });

  it("a gift answered since the round was found isn't in the email", async () => {
    const h = setup();
    const before = h.store.reactionAsks.get("r1")!;
    const record = h.store.recordSend.bind(h.store);
    vi.spyOn(h.store, "recordSend").mockImplementation(async (...a) => {
      h.store.reactionAsks.set("r1", { ...before, gifts: before.gifts.slice(1) });
      return record(...a);
    });
    await h.run();
    expect(h.emails[0].text).not.toContain("gift=o1");
    expect(h.emails[0].text).toContain("gift=o2");
    expect(h.emails[0].subject).toBe("How did Nora like the gift?");
  });

  it.each(["every gift answered", "the round closed or the person removed"])("%s since: no email, no alert, and the key goes back", async (since) => {
    const h = setup();
    if (since === "every gift answered") h.store.reactionAsks.get("r1")!.gifts = [];
    else h.store.reactionAsks.delete("r1");
    expect(await h.run()).toEqual({ closed: 0, asked: 0 });
    expect(h.emails).toEqual([]);
    expect(h.store.writes).toEqual(["recordSend:r1:reaction_prompt", "forgetSend:r1:reaction_prompt"]);
    expect(events()).toEqual([]);
  });

  it("a refused email gives the key back, alerts, and goes at the next tick", async () => {
    const h = setup();
    h.refuseOn.add(DAY);
    expect(await h.run()).toEqual({ closed: 0, asked: 0 });
    expect(h.asked()).toBe(false);
    expect(named("reactions.ask_failed")).toEqual([expect.objectContaining({ round_id: "r1", user_id: USER, alert: true })]);
    h.refuseOn.clear();
    expect(await h.run()).toEqual({ closed: 0, asked: 1 });
  });

  it("a read that throws gives the key back and alerts with ids only, and the other rounds are still asked", async () => {
    const h = setup({ r1: ["o1"], r2: ["o2"] });
    const read = h.store.reactionGifts.bind(h.store);
    vi.spyOn(h.store, "reactionGifts").mockImplementation(async (id) => {
      if (id === "r1") throw new Error("Nora's Gift o1");
      return read(id);
    });
    expect(await h.run()).toEqual({ closed: 0, asked: 1 });
    expect(h.asked("r1")).toBe(false);
    expect(h.asked("r2")).toBe(true);
    const failed = named("reactions.ask_failed");
    expect(failed).toEqual([expect.objectContaining({ round_id: "r1", user_id: USER, alert: true })]);
    expect(JSON.stringify(failed)).not.toContain("Nora");
  });

  it("a key that can't be given back, or claimed, alerts and stops nothing else", async () => {
    const h = setup({ r1: ["o1"], r2: ["o2"], r3: ["o3"] });
    const read = h.store.reactionGifts.bind(h.store);
    vi.spyOn(h.store, "reactionGifts").mockImplementation((id) => (id === "r1" ? Promise.reject(new Error("read")) : read(id)));
    vi.spyOn(h.store, "forgetSend").mockRejectedValue(new Error("forget"));
    const record = h.store.recordSend.bind(h.store);
    vi.spyOn(h.store, "recordSend").mockImplementation((id, u, s) => (id === "r2" ? Promise.reject(new Error("claim")) : record(id, u, s)));
    expect(await h.run()).toEqual({ closed: 0, asked: 1 });
    expect(new Set(named("reactions.ask_failed").map((e) => e.round_id))).toEqual(new Set(["r1", "r2"]));
    expect(h.asked("r3")).toBe(true);
  });
});

describe("the tick", () => {
  it.each([1, 0])("asks after the tracking news whatever round_engine_enabled says (%i)", async (on) => {
    const h = setup();
    h.store.settings.set("round_engine_enabled", on);
    const order: string[] = [];
    await runTick({
      ...h.deps(at(DAY)),
      trackingNews: async () => {
        order.push("news");
        return { sent: 0 };
      },
      reactions: () => {
        order.push("reactions");
        return h.run();
      },
    });
    expect(order).toEqual(["news", "reactions"]);
    expect(named("reactions.run")).toEqual([expect.objectContaining({ closed: 0, asked: 1 })]);
  });

  it.each(["closeReactedRounds", "reactionsDue"] as const)("%s failing (the code before its migration) alerts, and the tick finishes", async (method) => {
    const h = setup();
    vi.spyOn(h.store, method).mockRejectedValue(new Error("no such function"));
    const summary = await runTick({ ...h.deps(at(DAY)), reactions: h.run });
    expect(summary.enabled).toBe(true);
    expect(named("reactions.run_failed")).toEqual([expect.objectContaining({ alert: true })]);
    expect(named("reactions.run")).toEqual([]);
    expect(named("round_tick")).toHaveLength(1);
  });

  it("with nothing due and nothing closed, as when switched off, raises no alert", async () => {
    const h = setup({});
    await runTick({ ...h.deps(at(DAY)), reactions: h.run });
    expect(events().filter((e) => e.alert)).toEqual([]);
    expect(named("reactions.run")).toEqual([expect.objectContaining({ closed: 0, asked: 0 })]);
  });
});
