import { describe, expect, it, vi } from "vitest";
import { runReactions } from "../reactions/ask";
import { runTick } from "../rounds/engine";
import { at, BASE, captureLog, events, harness, named, USER } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// Asking how the gifts went over, against fake stores. Which rounds are due and which close is
// SQL's (reactions.test.sql, reactions-ask-db.test.ts).

captureLog();

const DAY = "2027-03-21";

function setup(rounds: Record<string, string[]> = { r1: ["o1", "o2"] }, users: Record<string, string> = {}) {
  const h = harness();
  for (const u of Object.values(users)) h.notifyStore.recipients.set(u, { email: `${u}@example.com`, timezone: null });
  for (const [roundId, orderIds] of Object.entries(rounds)) {
    h.store.reactionDue.push({ roundId, userId: users[roundId] ?? USER });
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

  it("a buyer's rounds go in one email, the earlier occasion first, each gift saying whose it was", async () => {
    const h = setup({ r1: ["o1"], r2: ["o2", "o3"] });
    Object.assign(h.store.reactionAsks.get("r2")!, { personName: "Dad", occasionKind: "anniversary", occasionDate: "2027-03-18" });
    expect(await h.run()).toEqual({ closed: 0, asked: 2 });
    expect(h.emails).toHaveLength(1);
    const { subject, text } = h.emails[0];
    expect(subject).toBe("How did your gifts go over?");
    const rows = [
      "- Gift o2 (Dad's anniversary, ",
      "/r2/reaction?gift=o2&r=loved",
      "- Gift o3 (Dad's anniversary, ",
      "/r2/reaction?gift=o3&r=returned",
      "- Gift o1 (Nora's birthday, ",
      "/r1/reaction?gift=o1&r=loved",
    ];
    for (const r of rows) expect(text).toContain(r);
    const places = rows.map((r) => text.indexOf(r));
    expect(places).toEqual([...places].sort((a, b) => a - b));
    expect(h.notifyStore.notifications).toEqual([expect.objectContaining({ kind: "reaction_prompt", roundId: null })]);
    expect([h.asked("r1"), h.asked("r2")]).toEqual([true, true]);
    expect(await h.run()).toEqual({ closed: 0, asked: 0 });
  });

  it("one round's email is recorded against its round", async () => {
    const h = setup();
    await h.run();
    expect(h.notifyStore.notifications).toEqual([expect.objectContaining({ roundId: "r1" })]);
  });

  it("each buyer gets their own email, and one refused buyer doesn't stop the next", async () => {
    const h = setup({ r1: ["o1"], r2: ["o2"] }, { r1: "user-a", r2: "user-b" });
    h.notifyStore.recipients.set("user-a", { email: null, timezone: null });
    expect(await h.run()).toEqual({ closed: 0, asked: 1 });
    expect(h.emails.map((e) => e.to)).toEqual(["user-b@example.com"]);
    expect([h.asked("r1"), h.asked("r2")]).toEqual([false, true]);
  });

  it.each(["refused", "throws"])("an email for several rounds (%s) gives every key back, even when one can't be", async (how) => {
    const h = setup({ r1: ["o1"], r2: ["o2"], r3: ["o3"] });
    if (how === "refused") h.refuseOn.add(DAY);
    else vi.spyOn(h.notifyStore, "recipient").mockRejectedValue(new Error("send"));
    const forget = h.store.forgetSend.bind(h.store);
    vi.spyOn(h.store, "forgetSend").mockImplementation((id, s) => (id === "r1" ? Promise.reject(new Error("forget")) : forget(id, s)));
    expect(await h.run()).toEqual({ closed: 0, asked: 0 });
    expect([h.asked("r1"), h.asked("r2"), h.asked("r3")]).toEqual([true, false, false]);
    expect(named("reactions.ask_failed").map((e) => `${e.round_id} ${e.phase}`)).toEqual(["r1 send", "r2 send", "r3 send", "r1 forget"]);
  });

  it("rounds that can't be put in order give every key back, and the next buyer is still asked", async () => {
    const h = setup({ r1: ["o1"], r2: ["o2"], r3: ["o3"] }, { r1: "user-a", r2: "user-a", r3: "user-b" });
    h.store.reactionAsks.get("r1")!.occasionDate = "not a date" as never;
    expect(await h.run()).toEqual({ closed: 0, asked: 1 });
    expect(h.emails.map((e) => e.to)).toEqual(["user-b@example.com"]);
    expect([h.asked("r1"), h.asked("r2"), h.asked("r3")]).toEqual([false, false, true]);
    expect(named("reactions.ask_failed").map((e) => `${e.round_id} ${e.phase}`)).toEqual(["r1 send", "r2 send"]);
  });

  it("a close that throws doesn't skip asking, and still fails the run", async () => {
    const h = setup();
    vi.spyOn(h.store, "closeReactedRounds").mockRejectedValue(new Error("close"));
    await expect(h.run()).rejects.toThrow("close");
    expect(h.emails).toHaveLength(1);
    expect(h.asked()).toBe(true);
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
    expect(named("reactions.ask_failed")).toEqual([expect.objectContaining({ round_id: "r1", user_id: USER, phase: "send", alert: true })]);
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
    expect(failed).toEqual([expect.objectContaining({ round_id: "r1", user_id: USER, phase: "read", alert: true })]);
    // One round is left, so it's that round's own email.
    expect(h.emails.map((e) => e.subject)).toEqual(["How did Nora like the gift?"]);
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
    expect(named("reactions.ask_failed").map((e) => `${e.round_id} ${e.phase}`)).toEqual(["r1 read", "r1 forget", "r2 claim"]);
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
