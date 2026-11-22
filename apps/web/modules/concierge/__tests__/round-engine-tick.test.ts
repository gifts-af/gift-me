// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { advanceRound, runTick, type EngineZinc } from "../rounds/engine";
import { USER, PERSON, OCCASION, NAME, EMAIL, BASE, at, harness, events, captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// The daily tick, an address arriving, and advancing one round, against fake stores.

captureLog();

describe("runTick", () => {
  it("creates and moves on no ordinary round when the engine is off (AC-2)", async () => {
    const h = harness();
    h.store.settings.set("round_engine_enabled", 0);

    const summary = await h.tick("2027-02-11");

    expect(summary).toEqual({ enabled: false, created: 0, advanced: 0, failed: 0 });
    expect(h.store.writes).toEqual([]);
    expect(h.notifyStore.notifications).toEqual([]);
    expect(events()).toEqual([expect.objectContaining({ event: "round_tick", enabled: false })]);
  });

  // ALL-112: closed and cancelled rounds are only reached this way, and it runs with the engine off.
  it.each([1, 0])("deals with rejected shared addresses on every tick (round_engine_enabled %i)", async (on) => {
    const h = harness();
    h.store.settings.set("round_engine_enabled", on);
    vi.spyOn(h.store, "roundsWithRejectedAddresses").mockResolvedValue(["round-x"]);
    const clear = vi.spyOn(h.store, "clearRejectedAddresses");
    await runTick(h.deps(at("2027-02-11")));
    expect(clear).toHaveBeenCalledWith("round-x");
  });

  // S6 (owner): the money path never waits on round_engine_enabled.
  it("still sweeps, retries ordered emails and claims money-path rounds when the engine is off", async () => {
    const sweep = vi.fn(async () => 0);
    const zinc: EngineZinc = {
      placeRound: vi.fn(async () => {}),
      sweep,
      wallet: async () => ({ balanceCents: null, autoTopUp: null }),
      lookahead: async () => ({ cents: 0, atLeast: false }),
      walletUrl: "https://zinc.test/wallet",
    };
    const h = harness({ zinc });
    await h.tick("2027-02-11"); // an ordinary round, awaiting approval
    sweep.mockClear();
    h.store.settings.set("round_engine_enabled", 0);
    const missing = vi.spyOn(h.store, "roundsMissingOrderedEmail");
    const money = vi.spyOn(h.store, "claimDueMoney");
    const due = vi.spyOn(h.store, "claimDue");
    const writes = h.store.writes.length;

    await h.tick("2027-02-16"); // reminder_1 would be due

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(missing).toHaveBeenCalledTimes(1);
    expect(money).toHaveBeenCalledTimes(1);
    expect(due).not.toHaveBeenCalled();
    expect(h.store.writes).toHaveLength(writes);
    expect(h.store.sends.get("round-1")!.has("reminder_1")).toBe(false);
  });

  it("creates a round on its start day, once, even across two ticks (AC-3, AC-4)", async () => {
    const h = harness();
    await h.tick("2027-02-10");
    expect(h.store.rounds).toHaveLength(0);

    const first = await h.tick("2027-02-11");
    const second = await h.tick("2027-02-11", "13:00:00");

    expect(first).toMatchObject({ enabled: true, created: 1, advanced: 1, failed: 0 });
    expect(second).toMatchObject({ created: 0 });
    expect(h.store.rounds).toHaveLength(1);
    expect(h.store.rounds[0]).toMatchObject({
      userId: USER,
      personId: PERSON,
      occasionId: OCCASION,
      occasionYear: 2027,
      occasionDate: "2027-03-20",
      shipByDeadline: "2027-03-11",
      budgetCents: 5000,
      late: false,
    });
  });

  it("runs a round from scheduled to skipped, each email once on its day (AC-5)", async () => {
    const h = harness();
    await h.runDays("2027-02-01", "2027-03-20");

    expect(h.sent()).toEqual([
      "heads_up@2027-02-11",
      "reminder@2027-02-16",
      "reminder@2027-03-04",
      "final_notice@2027-03-09",
      "skipped@2027-03-11",
    ]);
    const round = h.store.rounds[0];
    expect(round.history).toEqual(["scheduled", "generating", "awaiting_approval", "skipped"]);
    expect(round.status).toBe("skipped");
    expect(round.nextActionAt).toBeNull();
    expect([...h.store.sends.get(round.id)!]).toEqual([
      "heads_up",
      "reminder_1",
      "reminder_2",
      "final_notice",
      "skipped",
    ]);
    expect(h.store.rounds).toHaveLength(1);
    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
  });

  it("fills the emails with the person, dates and ideas, and one-time links to their page", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-03-11");

    const headsUp = h.emails[0];
    expect(headsUp.to).toBe(EMAIL);
    expect(headsUp.subject).toContain(`${NAME}'s birthday`);
    expect(headsUp.text).toContain("Sat, Mar 20");
    expect(headsUp.text).toContain("Stoneware mug set · $42");
    expect(headsUp.text).toContain("Herb planter · $38.50");
    const final = h.emails.find((e) => e.subject.startsWith("Last chance"))!;
    expect(final.text).toContain("by Wed, Mar 10");

    // The approval emails link to the round screen with plain links; only the skipped email's button is a one-time link.
    const links = h.notifyStore.links;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ userId: USER, roundId: "round-1", action: "open_person" });
    expect(links[0].expiresAt).toEqual(new Date("2027-03-11T23:59:00Z"));
  });

  it("the approval emails link each idea to its buy page and the button to the round screen (ALL-29 AC-1)", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-03-11");
    const ids = h.store.ideas.get("round-1")!.map((i) => i.id);
    expect(ids).toHaveLength(2);
    const round = `${BASE}/rounds/round-1`;
    const approval = h.emails.filter((e) => /gifts from their list|Reminder|Last chance/.test(e.subject));
    expect(approval).toHaveLength(4);
    for (const e of approval) {
      expect(e.html).toContain(`href="${round}"`);
      expect(e.text).toContain(`Pick several or none of these: ${round}`);
      ids.forEach((id) => expect(e.html).toContain(`href="${round}/buy?ideas=${id}"`));
      expect(e.html.match(/Buy this/g)).toHaveLength(2);
    }
    expect(approval[0].text).toContain("Arrives by");
    expect(approval[0].text).toContain("Loves tea.");
  });

  it("links open questions in the heads-up and reminders only (ALL-26 AC-10)", async () => {
    const h = harness();
    h.store.people.set(PERSON, { name: NAME, hasAddress: true, openQuestions: 2 });
    await h.runDays("2027-02-01", "2027-03-12");

    const asked = h.emails.filter((e) => e.text.includes(`Answer 2 quick questions about ${NAME}`));
    expect(asked.map((e) => h.sent()[h.emails.indexOf(e)].split("@")[0])).toEqual(["heads_up", "reminder", "reminder"]);
    const questionLinks = h.notifyStore.links.filter((l) => l.action === "answer_questions");
    expect(questionLinks).toHaveLength(3);
    for (const l of questionLinks) expect(l).toMatchObject({ userId: USER, roundId: "round-1" });
  });

  it("adds no link when no questions are open (ALL-26 AC-10)", async () => {
    const h = harness();
    await h.runDays("2027-02-01", "2027-03-12");
    expect(h.emails.some((e) => e.text.includes("quick question"))).toBe(false);
    expect(h.notifyStore.links.some((l) => l.action === "answer_questions")).toBe(false);
  });

  it("squeezes a late round's schedule and says time is short (AC-6)", async () => {
    const h = harness({ candidateFrom: "2027-03-05" });
    await h.runDays("2027-03-01", "2027-03-15");

    expect(h.sent()).toEqual(["heads_up@2027-03-05", "final_notice@2027-03-09", "skipped@2027-03-11"]);
    expect(h.store.rounds[0].late).toBe(true);
    expect(h.emails[0].text).toContain("is close, so we've kept only gifts that can still arrive in time");
  });

  it("asks for a missing address on the reminder schedule, then skips (AC-8)", async () => {
    const h = harness({ hasAddress: false });
    await h.runDays("2027-02-01", "2027-03-20");

    expect(h.sent()).toEqual([
      "needs_address@2027-02-11",
      "needs_address@2027-02-16",
      "needs_address@2027-03-04",
      "needs_address@2027-03-09",
      "skipped@2027-03-11",
    ]);
    const round = h.store.rounds[0];
    expect(round.history).toEqual(["scheduled", "needs_address", "skipped"]);
    expect([...h.store.sends.get(round.id)!]).toEqual([
      "address_request",
      "address_reminder_1",
      "address_reminder_2",
      "address_final_notice",
      "skipped",
    ]);
    expect(h.generateIdeas).not.toHaveBeenCalled();
    expect(h.emails[0].text).not.toContain("A reminder:");
    expect(h.emails[1].text).toContain("A reminder:");
    // The address emails' button opens the address form; the skipped email's opens the page (ALL-81 AC-8, AC-9).
    expect(h.notifyStore.links.map((l) => l.action)).toEqual([
      "add_address",
      "add_address",
      "add_address",
      "add_address",
      "open_person",
    ]);
  });
});

describe("an address arriving", () => {
  it("a share arriving after the last tick before the deadline still skips, with the skip email (ALL-63 AC-21)", async () => {
    const h = harness({ hasAddress: false });
    await h.runDays("2027-02-11", "2027-03-10");
    h.store.people.get(PERSON)!.hasAddress = true;
    await h.tick("2027-03-11");

    expect(h.store.rounds[0].status).toBe("skipped");
    expect(h.sent()).not.toContain("heads_up@2027-03-11");
    expect(h.sent()).toContain("skipped@2027-03-11");
  });

  it("a waiting round notices an address at the next daily tick, with no resume and no extra email (ALL-63 AC-19)", async () => {
    const h = harness({ hasAddress: false });
    await h.tick("2027-02-11");
    expect(h.store.rounds[0].status).toBe("needs_address");
    // Days before its next reminder, nothing goes out and the round is still looked at.
    await h.tick("2027-02-12");
    await h.tick("2027-02-13");
    expect(h.sent()).toEqual(["needs_address@2027-02-11"]);

    h.store.people.get(PERSON)!.hasAddress = true;
    await h.tick("2027-02-14");

    expect(h.store.rounds[0].status).toBe("awaiting_approval");
    expect(h.sent()).toEqual(["needs_address@2027-02-11", "heads_up@2027-02-14"]);
  });

  it("sends the heads-up on the next tick after the address arrives and restarts the reminders (AC-9)", async () => {
    const h = harness({ hasAddress: false });
    await h.runDays("2027-02-11", "2027-02-19");
    h.store.people.get(PERSON)!.hasAddress = true;

    await h.tick("2027-02-20");
    expect(h.store.rounds[0].status).toBe("awaiting_approval");
    expect(h.store.rounds[0].headsUpOn).toBe("2027-02-20");

    await h.runDays("2027-02-21", "2027-03-20");
    expect(h.sent()).toEqual([
      "needs_address@2027-02-11",
      "needs_address@2027-02-16",
      "heads_up@2027-02-20",
      "reminder@2027-02-25",
      "reminder@2027-03-04",
      "final_notice@2027-03-09",
      "skipped@2027-03-11",
    ]);
    expect(h.store.rounds[0].history).toEqual([
      "scheduled",
      "needs_address",
      "generating",
      "awaiting_approval",
      "skipped",
    ]);
  });

  it("saving an address doesn't generate: outside the tick, the round is left due for the next tick", async () => {
    const h = harness({ hasAddress: false });
    await h.tick("2027-02-11");
    h.store.people.get(PERSON)!.hasAddress = true;
    // Moving a waiting round on outside the tick (an address save used to) runs no idea run.
    h.today = "2027-02-12";
    expect(await advanceRound("round-1", h.deps(at("2027-02-12", "09:00:00")))).toBe("advanced");
    expect(h.generateIdeas).not.toHaveBeenCalled();
    expect(h.store.rounds[0]).toMatchObject({ status: "needs_address", nextActionAt: at("2027-02-12", "09:00:00"), lockedUntil: null });

    await h.tick("2027-02-12");
    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    expect(h.sent()).toEqual(["needs_address@2027-02-11", "heads_up@2027-02-12"]);
  });
});

describe("advanceRound", () => {
  it("leaves a round the tick holds alone (AC-10)", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    const now = at("2027-02-16");
    const held = await h.store.claim("round-1", now); // the tick has it
    expect(held).not.toBeNull();
    const sentBefore = h.sent().length;

    h.today = "2027-02-16";
    expect(await advanceRound("round-1", h.deps(new Date(now.getTime() + 1000)))).toBe("busy");
    expect(h.sent()).toHaveLength(sentBefore);
    expect(h.store.sends.get("round-1")!.has("reminder_1")).toBe(false);
  });

  it("does nothing when the engine is off", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    h.store.settings.set("round_engine_enabled", 0);
    const writes = h.store.writes.length;
    const sent = h.emails.length;

    h.today = "2027-02-16";
    expect(await advanceRound("round-1", h.deps(at("2027-02-16")))).toBe("off");
    expect(h.store.writes).toHaveLength(writes);
    expect(h.emails).toHaveLength(sent);
  });

  it("advances a due round right away", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    h.today = "2027-02-16";
    expect(await advanceRound("round-1", h.deps(at("2027-02-16", "08:00:00")))).toBe("advanced");
    expect(h.sent()).toContain("reminder@2027-02-16");
  });
});
