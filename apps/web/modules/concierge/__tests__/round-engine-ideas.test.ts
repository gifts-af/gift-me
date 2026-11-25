import type { StepKey } from "@gifts-af/core";
import { describe, expect, it, vi } from "vitest";
import type { IdeaOutcome } from "../ideas/run";
import { runRoundMessage, runTick, type EngineZinc } from "../rounds/engine";
import { USER, PERSON, OCCASION, NAME, EMAIL, at, harness, events, named, captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// The idea pass and what follows a run, against fake stores.

captureLog();

// ─── ALL-27: the idea pass, after everything else in the tick ───────────────

describe("the idea pass (ALL-27)", () => {
  const rule = { kind: "birthday" as const, month: 3, day: 20 };
  /** Two people with birthdays: Zelda on 03-20 (ship by 03-11) and Other on `otherDay` of March. */
  function two(otherDay = 20) {
    const h = harness();
    h.store.people.set("person-2", { name: "Other", hasAddress: true });
    h.store.occasionKinds.set("occasion-2", "birthday");
    h.today = "2027-02-11";
    h.store.candidateRows = [
      { userId: USER, personId: PERSON, occasionId: OCCASION, rule, budgetCents: 5000 },
      { userId: USER, personId: "person-2", occasionId: "occasion-2", rule: { ...rule, day: otherDay }, budgetCents: null },
    ];
    return h;
  }
  const saved = (h: ReturnType<typeof harness>) => async (round: { id: string }): Promise<IdeaOutcome> => {
    h.store.ideas.set(round.id, [{ id: "idea-1", title: "Book", totalCents: 2000, arriveBy: null, reason: null }]);
    return { status: "saved", count: 1 };
  };

  it("ideas run after the money path and rejection notices", async () => {
    const order: string[] = [];
    const zinc: EngineZinc = {
      placeRound: vi.fn(async () => {}),
      sweep: async () => order.push("sweep"),
      wallet: async () => ({ balanceCents: null, autoTopUp: null }),
      lookahead: async () => ({ cents: 0, atLeast: false }),
      walletUrl: "https://zinc.test/wallet",
    };
    const h = harness({ zinc });
    vi.spyOn(h.store, "roundsWithRejectedAddresses").mockImplementation(async () => {
      order.push("rejections");
      return [];
    });
    const claimDue = h.store.claimDue.bind(h.store);
    vi.spyOn(h.store, "claimDue").mockImplementation(async (now) => {
      order.push("rounds");
      return claimDue(now);
    });
    h.generateIdeas.mockImplementation(async (round) => {
      order.push("ideas");
      h.store.ideas.set(round.id, [{ id: "idea-1", title: "Book", totalCents: 2000, arriveBy: null, reason: null }]);
      return { status: "saved", count: 1 };
    });

    await h.tick("2027-02-11");

    expect(order).toEqual(["sweep", "rounds", "rejections", "ideas"]);
    expect(h.sent()).toEqual(["heads_up@2027-02-11"]);
  });

  it("a round that already has ideas sends the heads-up without a run (B1)", async () => {
    const h = harness();
    h.generateIdeas.mockResolvedValueOnce({ status: "none" });
    await h.tick("2027-02-11");
    expect(h.store.rounds[0].status).toBe("generating");
    // A run saved them, and its heads-up never went (a crash, say).
    h.store.ideas.set("round-1", [{ id: "idea-1", title: "Book", totalCents: 2000, arriveBy: null, reason: null }]);

    await h.tick("2027-02-12");

    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    expect(h.sent()).toEqual(["heads_up@2027-02-12"]);
    expect(h.store.rounds[0].status).toBe("awaiting_approval");
  });

  it("only idea_rounds_per_tick rounds generate; the rest are released uncounted", async () => {
    const h = two();
    h.store.settings.set("idea_rounds_per_tick", 1);
    h.generateIdeas.mockImplementation(saved(h));

    const summary = await runTick(h.deps(at("2027-02-11")));

    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ enabled: true, created: 2, advanced: 1, failed: 0 });
    const waiting = h.store.rounds.find((r) => r.status !== "awaiting_approval")!;
    expect(waiting).toMatchObject({ status: "scheduled", lockedUntil: null, attempts: 0 });
    expect(h.store.writes).toContain(`release:${waiting.id}`);

    // The next tick gives it its turn.
    await runTick(h.deps(at("2027-02-12")));
    expect(h.generateIdeas).toHaveBeenCalledTimes(2);
    expect(h.store.rounds.map((r) => r.status)).toEqual(["awaiting_approval", "awaiting_approval"]);
  });

  it("a refusal doesn't use the slot", async () => {
    const h = two();
    h.store.settings.set("idea_rounds_per_tick", 1);
    h.generateIdeas.mockResolvedValueOnce({ status: "refused", reason: "busy" }).mockImplementation(saved(h));

    await runTick(h.deps(at("2027-02-11")));

    expect(h.generateIdeas).toHaveBeenCalledTimes(2);
    const [busy, ran] = h.generateIdeas.mock.calls.map((c) => h.store.round(c[0].id));
    // Busy: released as it was, for the next tick.
    expect(busy).toMatchObject({ status: "generating", lockedUntil: null });
    expect(ran.status).toBe("awaiting_approval");
  });

  it("a round turned away by the daily limit is released, still due, and the limit is logged with ids only (ALL-125)", async () => {
    const h = harness();
    h.generateIdeas.mockResolvedValue({ status: "refused", reason: "daily_limit" });

    await h.tick("2027-02-11");

    expect(h.store.round("round-1")).toMatchObject({ status: "generating", lockedUntil: null });
    expect(h.store.writes).toContain("release:round-1");
    expect(named("round_step")).toContainEqual(expect.objectContaining({ round_id: "round-1", step: "ideas:refused:daily_limit" }));
    const limited = named("ideas.daily_limit_reached");
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ round_id: "round-1", user_id: USER, alert: true });
    for (const key of Object.keys(limited[0])) expect(["event", "at", "round_id", "user_id", "alert"]).toContain(key);
  });

  it.each<[string, IdeaOutcome | null, Record<string, number>]>([
    ["refused:busy", { status: "refused", reason: "busy" }, {}],
    ["refused:daily_limit", { status: "refused", reason: "daily_limit" }, {}],
    ["off", { status: "off" }, {}],
    ["no_credit", { status: "no_credit" }, {}],
    ["no_time", null, { tick_deadline_ms: 100_000 }],
    ["no_turn", null, { idea_rounds_per_tick: 0 }],
  ])("AC-11: fan-out off, a round that only waits (%s) is released and counted as neither advanced nor failed", async (_, outcome, settings) => {
    const h = harness();
    for (const [k, v] of Object.entries(settings)) h.store.settings.set(k, v);
    if (outcome) h.generateIdeas.mockResolvedValue(outcome);

    const summary = await h.tick("2027-02-11");

    expect(summary).toEqual({ enabled: true, created: 1, advanced: 0, failed: 0 });
    expect(named("round_tick")).toEqual([expect.objectContaining({ advanced: 0, failed: 0 })]);
    expect(h.generateIdeas).toHaveBeenCalledTimes(outcome ? 1 : 0);
    expect(h.store.round("round-1")).toMatchObject({ status: outcome ? "generating" : "scheduled", lockedUntil: null, attempts: 0 });
    expect(h.store.writes).toContain("release:round-1");
    expect(h.store.round("round-1").nextActionAt!.getTime()).toBeLessThanOrEqual(at("2027-02-11").getTime());
  });

  it("rounds nearest their deadline go first", async () => {
    // Other's birthday is 03-15, so their round ships by 03-06, before Zelda's 03-11.
    const h = two(15);
    h.store.settings.set("idea_rounds_per_tick", 1);
    h.generateIdeas.mockImplementation(saved(h));

    await runTick(h.deps(at("2027-02-11")));

    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    expect(h.generateIdeas.mock.calls[0][0]).toMatchObject({ userId: USER, personId: "person-2" });
  });

  it("no run starts when the time left is under the worst case", async () => {
    const h = harness();
    // The worst case is 2 × 60s + 2 × 15s, plus 1s + 2 × 15s for the list pass and 15s for photos = 196s; the tick has 100s.
    h.store.settings.set("tick_deadline_ms", 100_000);
    h.today = "2027-02-11";
    h.store.candidateRows = [{ userId: USER, personId: PERSON, occasionId: OCCASION, rule, budgetCents: 5000 }];

    await runTick({ ...h.deps(at("2027-02-11")), clock: () => 1_000 });

    expect(h.generateIdeas).not.toHaveBeenCalled();
    expect(h.store.rounds[0]).toMatchObject({ status: "scheduled", lockedUntil: null });
    expect(h.sent()).toEqual([]);
  });

  it("gives the run a signal that aborts at the tick's deadline", async () => {
    const h = harness();
    await h.tick("2027-02-11");
    const signal = h.generateIdeas.mock.calls[0][1];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  // Controller ruling: tick_deadline_ms only bounds the idea pass, never the rounds before it.
  it("past the tick deadline, claimed rounds still take their step; only the idea run waits", async () => {
    const h = harness();
    await h.tick("2027-02-11"); // round-1: heads-up
    h.store.people.set("person-2", { name: "Other", hasAddress: true });
    h.store.occasionKinds.set("occasion-2", "birthday");
    let looks = 0;
    // The tick starts at 0; by its first look at a round, its 270s are long gone.
    const clock = () => (looks++ === 0 ? 0 : 1_000_000);
    h.today = "2027-02-16";
    h.store.candidateRows = [
      { userId: USER, personId: "person-2", occasionId: "occasion-2", rule: { kind: "birthday", month: 3, day: 20 }, budgetCents: null },
    ];
    const summary = await runTick({ ...h.deps(at("2027-02-16")), clock });

    // Round 1's reminder goes; round 2 needs ideas, so it's released with no run.
    expect(summary).toMatchObject({ advanced: 1, failed: 0 });
    expect(h.sent()).toEqual(["heads_up@2027-02-11", "reminder@2027-02-16"]);
    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    expect(h.store.round("round-2")).toMatchObject({ status: "scheduled", lockedUntil: null });
    expect(named("round_tick_out_of_time")).toEqual([]);
  });

  it("with the engine off, a money round that fails is counted as failed", async () => {
    const h = harness();
    await h.tick("2027-02-11");
    h.store.settings.set("round_engine_enabled", 0);
    h.store.rounds[0].status = "needs_attention";
    h.store.rounds[0].nextActionAt = at("2027-02-12", "00:00:00");
    vi.spyOn(h.store, "roundContext").mockRejectedValue(new Error("database down"));

    const summary = await h.tick("2027-02-12");

    expect(summary).toEqual({ enabled: false, created: 0, advanced: 0, failed: 1 });
  });

  it("a run that saves none, with a newer fact, stays generating and runs again", async () => {
    const h = harness();
    h.generateIdeas.mockResolvedValue({ status: "none" });

    await h.tick("2027-02-11");

    expect(h.store.rounds[0]).toMatchObject({ status: "generating", nextActionAt: at("2027-02-11"), lockedUntil: null });
    expect(h.sent()).toEqual([]);
    // A run is left (the fake's round_idea_state), so the next tick runs again.
    await h.tick("2027-02-12");
    expect(h.generateIdeas).toHaveBeenCalledTimes(2);
  });

  it.each(["failed", "deadline", "cost_cap"] as const)("a run that ends %s stays generating for the next tick", async (status) => {
    const h = harness();
    h.generateIdeas.mockResolvedValue({ status });
    await h.tick("2027-02-11");
    expect(h.store.rounds[0]).toMatchObject({ status: "generating", nextActionAt: at("2027-02-11"), lockedUntil: null });
    expect(h.sent()).toEqual([]);
  });

  it("AC-10: a no-ideas email due on an ordinary step the day before ship-by is the too-late one; earlier it asks", async () => {
    for (const [day, subject] of [
      ["2027-03-10", "Sorry, no gift can arrive in time for Zelda Quartermain"],
      ["2027-03-09", "Sorry, we couldn't get gift ideas for Zelda Quartermain yet"],
    ] as const) {
      const h = harness({ candidateFrom: day });
      h.store.ideaState.set("round-1", { hasFacts: false });
      await h.tick(day);
      expect(h.emails.map((e) => e.subject)).toEqual([subject]);
      expect(h.notifyStore.links).toHaveLength(day === "2027-03-10" ? 0 : 1);
    }
  });

  it("AC-10: a refused too-late email still ends the round's tries that day", async () => {
    const h = harness({ candidateFrom: "2027-03-10" });
    h.generateIdeas.mockResolvedValue({ status: "none" });
    h.refuseOn.add("2027-03-10");
    const summary = await h.tick("2027-03-10");
    expect(summary.failed).toBe(0);
    expect(named("round_too_late_email_failed")).toEqual([expect.objectContaining({ round_id: "round-1" })]);
    expect(h.store.rounds[0].nextActionAt).toEqual(at("2027-03-11", "00:00:00"));
    h.refuseOn.clear();
    await h.tick("2027-03-10", "13:00:00");
    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    expect(h.sent()).toEqual([]);
  });

  it("saved with count 0 sends no heads-up", async () => {
    const h = harness();
    h.generateIdeas.mockResolvedValue({ status: "saved", count: 0 });

    await h.tick("2027-02-11");

    // The person was removed mid-run: nothing more until the deadline closes the round.
    expect(h.store.rounds[0]).toMatchObject({ status: "generating", nextActionAt: at("2027-03-11", "00:00:00") });
    expect(h.sent()).toEqual([]);
  });

  it.each(["not_paid", "not_found"] as const)("refused %s waits for the deadline, which skips", async (reason) => {
    const h = harness();
    h.generateIdeas.mockResolvedValue({ status: "refused", reason });
    await h.tick("2027-02-11");
    expect(h.store.rounds[0]).toMatchObject({ status: "generating", nextActionAt: at("2027-03-11", "00:00:00") });
    await h.runDays("2027-02-12", "2027-03-11");
    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    expect(h.store.rounds[0].status).toBe("skipped");
    expect(h.sent()).toEqual([]);
  });

  it("off releases the round, for a tick once the engine is on", async () => {
    const h = harness();
    h.generateIdeas.mockResolvedValueOnce({ status: "off" });
    await h.tick("2027-02-11");
    expect(h.store.rounds[0]).toMatchObject({ status: "generating", lockedUntil: null });
    expect(h.sent()).toEqual([]);
    await h.tick("2027-02-12");
    expect(h.sent()).toEqual(["heads_up@2027-02-12"]);
  });

  it("refused limit or no facts: the plan sends no_ideas on the next tick", async () => {
    for (const outcome of [{ status: "refused", reason: "limit" }, { status: "no_facts" }] as IdeaOutcome[]) {
      const h = harness();
      h.generateIdeas.mockImplementation(async (round) => {
        h.store.ideaState.set(round.id, outcome.status === "no_facts" ? { hasFacts: false } : { ideaRunsLeft: false });
        return outcome;
      });
      await h.tick("2027-02-11");
      expect(h.store.rounds[0]).toMatchObject({ status: "generating", nextActionAt: at("2027-02-11") });
      await h.tick("2027-02-12");
      expect(h.sent()).toEqual(["no_ideas@2027-02-12"]);
      expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    }
  });

  it("a skip after no_ideas is emailed", async () => {
    const h = harness();
    h.store.ideaState.set("round-1", { hasFacts: false });
    await h.runDays("2027-02-11", "2027-03-20");

    expect(h.generateIdeas).not.toHaveBeenCalled();
    expect(h.sent()).toEqual(["no_ideas@2027-02-11", "skipped@2027-03-11"]);
    const sorry = h.emails[0];
    expect(sorry.subject).toBe(`Sorry, we couldn't get gift ideas for ${NAME} yet`);
    expect(h.notifyStore.links[0]).toMatchObject({ action: "answer_questions", roundId: "round-1" });
  });

  it("runs spent: no_ideas once; after the extra run finds nothing too, no_ideas_again", async () => {
    const h = harness();
    h.generateIdeas.mockImplementation(async (round) => {
      const runs = h.generateIdeas.mock.calls.length;
      // Two runs a round; the third is the extra one a new fact allowed.
      h.store.ideaState.set(round.id, { ideaRunsLeft: runs < 2, ranSinceNoIdeas: runs > 2 });
      return { status: "none" };
    });
    await h.runDays("2027-02-11", "2027-02-15");
    expect(h.generateIdeas).toHaveBeenCalledTimes(2);
    expect(h.sent()).toEqual(["no_ideas@2027-02-13"]);
    expect(h.store.rounds[0].nextActionAt).toEqual(at("2027-03-11", "00:00:00"));

    // A new fact: the trigger makes the round due, and one more run is allowed.
    h.store.ideaState.set("round-1", { ideaRunsLeft: true });
    h.store.rounds[0].nextActionAt = at("2027-02-16", "00:00:00");
    await h.runDays("2027-02-16", "2027-02-20");
    expect(h.generateIdeas).toHaveBeenCalledTimes(3);
    // Both are the no_ideas email; the second is the again version.
    expect(h.sent()).toEqual(["no_ideas@2027-02-13", "no_ideas@2027-02-17"]);
    expect([...h.store.sends.get("round-1")!]).toEqual(["no_ideas", "no_ideas_again"]);
    expect(h.emails[1].text).toContain("We tried again and still couldn't find a good fit");
  });

  it("with the idea engine off, nobody gets no_ideas: the round is released each tick and skips silently", async () => {
    for (const state of [{ hasFacts: false }, { ideaRunsLeft: false }, {}]) {
      const h = harness();
      const silentBefore = named("round_skipped_silently").length;
      h.store.ideaState.set("round-1", { ...state, ideaEngineOn: false });
      // What runIdeas says with idea_engine_enabled = 0, before any facts check.
      h.generateIdeas.mockResolvedValue({ status: "off" });
      await h.runDays("2027-02-11", "2027-03-20");

      expect(h.sent()).toEqual([]);
      expect(h.store.sends.get("round-1") ?? new Set()).not.toContain("no_ideas");
      expect(h.generateIdeas).toHaveBeenCalledTimes(28); // each day from 02-11 to 03-10
      expect(h.store.rounds[0].status).toBe("skipped");
      expect(named("round_skipped_silently")).toHaveLength(silentBefore + 1);
    }
  });

  it("an unpaid round runs nothing, sends nothing and skips silently at its deadline", async () => {
    for (const state of [{}, { hasFacts: false }, { ideaRunsLeft: false }]) {
      const h = harness();
      h.store.ideaState.set("round-1", { ...state, paid: false });
      await h.runDays("2027-02-11", "2027-03-20");

      expect(h.generateIdeas).not.toHaveBeenCalled();
      expect(h.sent()).toEqual([]);
      expect(h.store.rounds[0]).toMatchObject({ status: "skipped" });
      expect(h.store.rounds[0].history).toEqual(["scheduled", "skipped"]);
    }
  });

  it("an unreadable tick_deadline_ms never stops the other rounds: no deadline for them, and no idea runs", async () => {
    const h = harness();
    await h.tick("2027-02-11"); // round-1: heads-up
    h.store.people.set("person-2", { name: "Other", hasAddress: true });
    h.store.occasionKinds.set("occasion-2", "birthday");
    h.store.settings.delete("tick_deadline_ms");
    h.today = "2027-02-16";
    h.store.candidateRows = [
      { userId: USER, personId: "person-2", occasionId: "occasion-2", rule: { kind: "birthday", month: 3, day: 20 }, budgetCents: null },
    ];

    await runTick(h.deps(at("2027-02-16")));

    // Round 1's reminder still goes; round 2 waits, released, with no run.
    expect(h.sent()).toEqual(["heads_up@2027-02-11", "reminder@2027-02-16"]);
    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    expect(h.store.round("round-2")).toMatchObject({ status: "scheduled", lockedUntil: null });
    const unreadable = named("round_tick_deadline_unreadable");
    expect(unreadable).toHaveLength(1);
    // The error's name only: no message, no setting value.
    expect(unreadable[0]).toMatchObject({ name: "Error" });
    for (const key of Object.keys(unreadable[0])) expect(["event", "at", "name"]).toContain(key);
  });

  it.each([
    [{ status: "refused", reason: "busy" }, "ideas:refused:busy"],
    [{ status: "refused", reason: "not_paid" }, "ideas:refused:not_paid"],
    [{ status: "refused", reason: "limit" }, "ideas:refused:limit"],
    [{ status: "off" }, "ideas:off"],
  ] as [IdeaOutcome, string][])("logs what the run came to, with a refusal's reason (%o)", async (outcome, step) => {
    const h = harness();
    h.generateIdeas.mockResolvedValue(outcome);
    await h.tick("2027-02-11");
    expect(named("round_step")).toContainEqual(expect.objectContaining({ round_id: "round-1", step }));
  });

  it("an over-budget idea is labeled in the heads-up", async () => {
    const h = harness();
    h.generateIdeas.mockImplementation(async (round) => {
      h.store.ideas.set(round.id, [
        { title: "Book", totalCents: 2000 },
        { title: "Espresso machine", totalCents: 5500, overBudget: true },
      ]);
      return { status: "saved", count: 2 };
    });
    await h.tick("2027-02-11");
    expect(h.emails[0].text).toContain("- Espresso machine · $55 (Over budget)");
    expect(h.emails[0].text).not.toContain("Book · $20 (Over budget)");
  });

  it("logs ids, counts and outcomes only", async () => {
    const h = harness();
    h.generateIdeas.mockResolvedValue({ status: "none" });
    await h.runDays("2027-02-11", "2027-02-14");
    for (const e of events()) {
      const text = JSON.stringify(e);
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(EMAIL);
    }
    expect(named("round_step")).toContainEqual(expect.objectContaining({ round_id: "round-1", step: "ideas:none" }));
  });

  describe("out of AI credit (no_credit)", () => {
    it("AC-10: a no_credit run releases the round, sends the buyer nothing and logs ideas.no_credit with alert", async () => {
      const h = harness();
      h.generateIdeas.mockResolvedValue({ status: "no_credit" });

      const summary = await h.tick("2027-02-11");

      expect(summary).toMatchObject({ failed: 0 });
      expect(h.store.round("round-1")).toMatchObject({ status: "generating", lockedUntil: null, attempts: 0 });
      expect(h.store.round("round-1").nextActionAt!.getTime()).toBeLessThanOrEqual(at("2027-02-11").getTime());
      expect(h.store.writes).toContain("release:round-1");
      expect(h.notifyStore.notifications).toEqual([]);
      const alerts = named("ideas.no_credit");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({ round_id: "round-1", user_id: USER, alert: true });
      for (const key of Object.keys(alerts[0])) expect(["event", "at", "round_id", "user_id", "alert"]).toContain(key);
      expect(named("round_step")).toContainEqual(expect.objectContaining({ round_id: "round-1", step: "ideas:no_credit" }));
    });

    it("after a no_credit run the tick starts no other run and releases the rest", async () => {
      const h = two();
      h.generateIdeas.mockResolvedValue({ status: "no_credit" });

      const summary = await runTick(h.deps(at("2027-02-11")));

      expect(summary).toMatchObject({ advanced: 0, failed: 0 });
      expect(h.generateIdeas).toHaveBeenCalledTimes(1);
      for (const r of h.store.rounds) {
        expect(r.lockedUntil).toBeNull();
        expect(h.store.writes).toContain(`release:${r.id}`);
      }
      expect(h.notifyStore.notifications).toEqual([]);
    });

    it("with fan-out on the stop holds per job, not per tick: each due round's job starts its own run and logs its own alert", async () => {
      // The daily guard (idea_round_runs_per_day, in start_idea_run) bounds these runs; here each
      // job is a separate call, so nothing carries one job's no_credit to the next.
      const h = two();
      h.generateIdeas.mockResolvedValue({ status: "no_credit" });
      await runTick(h.deps(at("2027-02-11")));
      expect(h.generateIdeas).toHaveBeenCalledTimes(1);
      const alertsBefore = named("ideas.no_credit").length;

      h.store.settings.set("round_fanout_enabled", 1);
      const sendJobs = async () => ({ sent: 0, failed: 0 });
      for (const r of h.store.rounds) {
        expect(await runRoundMessage({ kind: "round", roundId: r.id }, { ...h.deps(at("2027-02-12")), sendJobs })).toBe("waiting");
      }

      expect(h.generateIdeas).toHaveBeenCalledTimes(3);
      expect(named("ideas.no_credit")).toHaveLength(alertsBefore + 2);
      for (const r of h.store.rounds) expect(r).toMatchObject({ status: "generating", lockedUntil: null });
      expect(h.notifyStore.notifications).toEqual([]);
    });

    it("a round still waiting on credit at its deadline is skipped with the skipped email, not silently", async () => {
      const h = harness();
      h.generateIdeas.mockResolvedValue({ status: "no_credit" });
      // What the real store reads once the round's latest run ended no_credit (no-credit-db.test.ts).
      h.store.ideaState.set("round-1", { waitingOnCredit: true });
      const silentBefore = named("round_skipped_silently").length;

      await h.runDays("2027-02-11", "2027-03-11");

      expect(h.store.rounds[0].status).toBe("skipped");
      expect(h.sent()).toEqual(["skipped@2027-03-11"]);
      expect(named("round_skipped_silently")).toHaveLength(silentBefore);
    });

    it("the next tick runs it again", async () => {
      const h = harness();
      h.generateIdeas.mockResolvedValueOnce({ status: "no_credit" });
      await h.tick("2027-02-11");
      expect(h.generateIdeas).toHaveBeenCalledTimes(1);

      await h.tick("2027-02-12");

      expect(h.generateIdeas).toHaveBeenCalledTimes(2);
      expect(h.sent()).toEqual(["heads_up@2027-02-12"]);
      expect(h.store.round("round-1").status).toBe("awaiting_approval");
    });
  });
});

describe("after None of these, and list-only people (ALL-29 AC-13, AC-28)", () => {
  /** Each run saves a fresh pair of ideas, numbered by run. */
  function rejecting() {
    const h = harness();
    h.generateIdeas.mockImplementation(async (round) => {
      const n = h.generateIdeas.mock.calls.length;
      h.store.ideas.set(round.id, [{ title: `Idea set ${n}`, totalCents: 2000 }]);
      return { status: "saved", count: 1 };
    });
    return h;
  }

  it("with heads_up@1 sent and no heads_up, a round with new ideas sends heads_up", async () => {
    const h = rejecting();
    h.store.sends.set("round-1", new Set<StepKey>(["heads_up@1", "reminder_1@1"]));
    await h.tick("2027-02-11");
    expect(h.sent()).toEqual(["heads_up@2027-02-11"]);
    expect(h.store.sends.get("round-1")).toContain("heads_up");
    expect(h.store.rounds[0].status).toBe("awaiting_approval");
  });

  it("a rejected round runs ideas on the next tick and sends a second heads-up with the new ideas", async () => {
    const h = rejecting();
    await h.runDays("2027-02-11", "2027-02-16"); // heads-up, then reminder 1
    expect(h.sent()).toEqual(["heads_up@2027-02-11", "reminder@2027-02-16"]);

    h.store.reject("round-1", at("2027-02-17", "09:00:00"));
    await h.tick("2027-02-17");

    expect(h.generateIdeas).toHaveBeenCalledTimes(2);
    expect(h.sent()).toEqual(["heads_up@2027-02-11", "reminder@2027-02-16", "heads_up@2027-02-17"]);
    expect(h.emails[2].text).toContain("Idea set 2");
    expect(h.emails[2].text).not.toContain("Idea set 1");
    expect(h.store.rounds[0]).toMatchObject({ status: "awaiting_approval", headsUpOn: "2027-02-17" });
    expect([...h.store.sends.get("round-1")!].sort()).toEqual(["heads_up", "heads_up@1", "reminder_1@1"]);

    // The new ideas get their own reminders: reminder 1 five days after the new heads-up.
    await h.runDays("2027-02-18", "2027-02-22");
    expect(h.sent().slice(3)).toEqual(["reminder@2027-02-22"]);
    expect(h.generateIdeas).toHaveBeenCalledTimes(2);
  });

  it("a rejected round whose runs find nothing sends no_ideas once, and later ticks send nothing more", async () => {
    const h = rejecting();
    await h.tick("2027-02-11");
    h.store.reject("round-1", at("2027-02-12", "09:00:00"));
    h.generateIdeas.mockImplementation(async (round) => {
      // Its runs are spent now: the extra one too.
      h.store.ideaState.set(round.id, { ideaRunsLeft: false });
      return { status: "none" };
    });

    await h.runDays("2027-02-12", "2027-03-10");

    expect(h.generateIdeas).toHaveBeenCalledTimes(2);
    expect(h.sent()).toEqual(["heads_up@2027-02-11", "no_ideas@2027-02-13"]);
    expect([...h.store.sends.get("round-1")!].sort()).toEqual(["heads_up@1", "no_ideas"]);
  });

  it("the deadline skip emails a buyer whose only heads-up is heads_up@1", async () => {
    const h = rejecting();
    await h.tick("2027-02-11");
    h.store.reject("round-1", at("2027-02-12", "09:00:00"));
    // The engine is switched off after the rejection: no run, no no_ideas, until the deadline.
    h.generateIdeas.mockResolvedValue({ status: "off" });
    h.store.ideaState.set("round-1", { ideaEngineOn: false });

    await h.runDays("2027-02-12", "2027-03-11");

    expect(h.store.rounds[0].status).toBe("skipped");
    expect(h.sent()).toEqual(["heads_up@2027-02-11", "skipped@2027-03-11"]);
  });

  it("a person with no facts but list gifts gets ideas and a heads-up, not no_ideas", async () => {
    const h = rejecting();
    h.store.ideaState.set("round-1", { hasFacts: false, hasListGifts: true });
    await h.tick("2027-02-11");
    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
    expect(h.sent()).toEqual(["heads_up@2027-02-11"]);
  });
});

// ─── ALL-32: held rounds, against the real local database (E5); only Zinc is faked ───
