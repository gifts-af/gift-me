import { addDays } from "@gifts-af/core";
import { describe, expect, it, vi } from "vitest";
import { runTick, type EngineZinc } from "../rounds/engine";
import { USER, PERSON, OCCASION, NAME, EMAIL, at, harness, events, named, captureLog } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// When a step fails, the events it logs, the heads-up funding warning and the notes clear-out,
// against fake stores.

captureLog();

describe("failures", () => {
  it("never sends an email twice when a step dies after recording it (AC-11)", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    // The process "dies" after the email went out: notify throws, not a clean refusal.
    const finish = h.notifyStore.finishNotification.bind(h.notifyStore);
    h.notifyStore.finishNotification = async () => {
      h.notifyStore.finishNotification = finish;
      throw new Error("connection lost");
    };

    expect(await h.tick("2027-02-16")).toMatchObject({ advanced: 0, failed: 1 });
    expect(await h.tick("2027-02-16", "12:05:00")).toMatchObject({ advanced: 0, failed: 0 }); // still leased
    expect(await h.tick("2027-02-16", "12:11:00")).toMatchObject({ advanced: 1, failed: 0 }); // lease expired

    expect(h.emails.filter((e) => e.subject.startsWith("Reminder"))).toHaveLength(1);
    expect(h.store.rounds[0].status).toBe("awaiting_approval");
    expect(h.store.rounds[0].nextActionAt).toEqual(at("2027-03-04", "00:00:00"));
  });

  // The heads-up and the skip are where the send record is the only guard:
  // nextAction keeps saying "generate" or "skip" until the status moves on.
  it.each([
    { step: "heads_up", day: "2027-02-11", subject: "Zelda Quartermain's birthday: 2 gift ideas", status: "awaiting_approval" },
    { step: "skipped", day: "2027-03-11", subject: "No gift for", status: "skipped" },
  ])("never resends $step after a crash mid-step (AC-11)", async ({ day, subject, status }) => {
    const h = harness();
    await h.runDays("2027-02-01", addDays(day, -1));
    const finish = h.notifyStore.finishNotification.bind(h.notifyStore);
    h.notifyStore.finishNotification = async () => {
      h.notifyStore.finishNotification = finish;
      throw new Error("connection lost");
    };

    expect(await h.tick(day)).toMatchObject({ failed: 1 });
    expect(await h.tick(day, "12:11:00")).toMatchObject({ advanced: 1, failed: 0 });

    expect(h.emails.filter((e) => e.subject.startsWith(subject))).toHaveLength(1);
    expect(h.store.rounds[0].status).toBe(status);
  });

  it("retries a clean refusal daily, logs round_stuck after 3 failures, and resets on success (AC-12)", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-02-15");
    h.refuseOn = new Set(["2027-02-16", "2027-02-17", "2027-02-18", "2027-02-20"]);

    for (const day of ["2027-02-16", "2027-02-17", "2027-02-18"]) {
      expect(await h.tick(day)).toMatchObject({ failed: 1 });
      expect(h.store.rounds[0].status).toBe("awaiting_approval");
      expect(h.store.sends.get("round-1")!.has("reminder_1")).toBe(false);
    }
    expect(named("round_stuck")).toEqual([]);
    expect(h.store.rounds[0].attempts).toBe(3);

    // The 4th tick: logged as stuck, and the step still runs (and works).
    expect(await h.tick("2027-02-19")).toMatchObject({ advanced: 1, failed: 0 });
    expect(named("round_stuck")).toEqual([
      expect.objectContaining({ round_id: "round-1", user_id: USER, status: "awaiting_approval", attempts: 4 }),
    ]);
    expect(h.sent()).toContain("reminder@2027-02-19");
    expect(h.store.rounds[0].attempts).toBe(0);

    // The count starts over: nothing more is due until reminder 2.
    await h.runDays("2027-02-20", "2027-03-03");
    expect(named("round_stuck")).toHaveLength(1);
    // The buyer only ever got the reminder, never an email about our failure.
    expect(h.sent()).toEqual(["heads_up@2027-02-11", "reminder@2027-02-19"]);
  });

  it("still skips a stuck round at its deadline", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-03-03");
    h.refuseOn = new Set(["2027-03-04", "2027-03-05", "2027-03-06", "2027-03-07", "2027-03-08", "2027-03-09", "2027-03-10"]);
    await h.runDays("2027-03-04", "2027-03-11");
    expect(h.store.rounds[0].status).toBe("skipped");
    expect(h.sent().at(-1)).toBe("skipped@2027-03-11");
  });

  it("still skips at the deadline when the skipped email is refused, and says so (ruling 12)", async () => {
    const h = harness();
    await h.runDays("2027-02-11", "2027-03-10");
    h.refuseOn = new Set(["2027-03-11"]);

    expect(await h.tick("2027-03-11")).toMatchObject({ advanced: 1, failed: 0 });

    const round = h.store.rounds[0];
    expect(round.status).toBe("skipped");
    expect(round.nextActionAt).toBeNull();
    // Nothing went out, so nothing is recorded as sent.
    expect(h.store.sends.get(round.id)!.has("skipped")).toBe(false);
    expect(named("round_skip_email_failed")).toEqual([
      expect.objectContaining({ round_id: round.id, user_id: USER }),
    ]);
    await h.runDays("2027-03-12", "2027-03-20");
    expect(h.sent().filter((s) => s.startsWith("skipped"))).toEqual([]);
  });

  it("skips silently a round whose buyer was never asked (ruling 13)", async () => {
    const h = harness();
    h.generateIdeas.mockImplementation(async () => {
      throw new Error("ideas failed");
    });
    await h.runDays("2027-02-11", "2027-03-20");

    const round = h.store.rounds[0];
    expect(round.status).toBe("skipped");
    expect(round.history).toEqual(["scheduled", "generating", "skipped"]);
    expect(round.nextActionAt).toBeNull();
    expect(h.sent()).toEqual([]);
    expect(named("round_skipped_silently")).toEqual([
      expect.objectContaining({ round_id: round.id, user_id: USER, status: "generating" }),
    ]);
  });

  it("keeps the other rounds going when one fails", async () => {
    const h = harness();
    h.store.people.set("person-2", { name: "Other", hasAddress: true });
    h.store.occasionKinds.set("occasion-2", "birthday");
    h.generateIdeas.mockImplementation(async (round) => {
      if (round.id === "round-1") throw new Error("ideas failed");
      h.store.ideas.set(round.id, [{ id: "idea-1", title: "Book", totalCents: 2000, arriveBy: null, reason: null }]);
      return { status: "saved", count: 1 };
    });
    // Two people with a birthday the same day.
    const rule = { kind: "birthday" as const, month: 3, day: 20 };
    h.today = "2027-02-11";
    h.store.candidateRows = [
      { userId: USER, personId: PERSON, occasionId: OCCASION, rule, budgetCents: 5000 },
      { userId: USER, personId: "person-2", occasionId: "occasion-2", rule, budgetCents: null },
    ];
    const summary = await runTick(h.deps(at("2027-02-11")));

    expect(summary).toEqual({ enabled: true, created: 2, advanced: 1, failed: 1 });
    expect(h.store.round("round-2").status).toBe("awaiting_approval");
  });

  it("keeps creating and advancing rounds when one occasion fails to create", async () => {
    const h = harness();
    h.store.people.set("person-2", { name: "Other", hasAddress: true });
    h.store.occasionKinds.set("occasion-2", "birthday");
    const insert = h.store.insertRound.bind(h.store);
    h.store.insertRound = async (r) => {
      if (r.personId === PERSON) throw new Error("insert failed");
      return insert(r);
    };
    const rule = { kind: "birthday" as const, month: 3, day: 20 };
    h.today = "2027-02-11";
    h.store.candidateRows = [
      { userId: USER, personId: PERSON, occasionId: OCCASION, rule, budgetCents: 5000 },
      { userId: USER, personId: "person-2", occasionId: "occasion-2", rule, budgetCents: null },
    ];

    const summary = await runTick(h.deps(at("2027-02-11")));

    // `failed` counts the occasion that couldn't be created as well as rounds that failed.
    expect(summary).toEqual({ enabled: true, created: 1, advanced: 1, failed: 1 });
    expect(h.store.rounds[0]).toMatchObject({ personId: "person-2", status: "awaiting_approval" });
    expect(named("round_create_failed")).toEqual([
      expect.objectContaining({ occasion_id: OCCASION, person_id: PERSON, user_id: USER }),
    ]);
    expect(named("round_tick")).toHaveLength(1);
  });
});

describe("events (AC-14)", () => {
  it("log ids, statuses and counts only", async () => {
    const h = harness({ hasAddress: false });
    h.refuseOn = new Set(["2027-02-16", "2027-02-17", "2027-02-18", "2027-02-19"]);
    await h.runDays("2027-02-11", "2027-02-19");
    h.store.people.get(PERSON)!.hasAddress = true;
    await h.runDays("2027-02-20", "2027-03-12");

    const allowed = new Set([
      "event",
      "at",
      "enabled",
      "created",
      "advanced",
      "failed",
      "round_id",
      "user_id",
      "status",
      "next_status",
      "step",
      "attempts",
      "error",
      // errorFields (N3): the error's name, and its kind and code when they are plain tokens.
      "name",
      "kind",
      "code",
    ]);
    expect(named("round_tick").length).toBeGreaterThan(0);
    expect(named("round_stuck").length).toBeGreaterThan(0);
    for (const e of events()) {
      for (const key of Object.keys(e)) expect(allowed).toContain(key);
      const text = JSON.stringify(e);
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain("Stoneware");
    }
  });
});

// ─── ALL-32: the heads-up's funding warning (AC-11) ─────────────────────────

describe("heads-up funding warning (AC-11)", () => {
  function zincFake(over: Partial<EngineZinc> = {}) {
    return {
      placeRound: vi.fn(async () => {}),
      sweep: vi.fn(async () => 0),
      wallet: vi.fn(async () => ({ balanceCents: 4000, autoTopUp: false as boolean | null })),
      lookahead: vi.fn(async () => ({ cents: 16000, atLeast: false })),
      walletUrl: "https://zinc.test/wallet",
      ...over,
    };
  }
  function funded(zinc: ReturnType<typeof zincFake>, canBuy: boolean) {
    const h = harness({ zinc });
    h.store.canBuyResult = canBuy;
    h.store.settings.set("funding_lookahead_days", 21);
    h.store.settings.set("zinc_order_fee_cents", 100);
    return h;
  }

  it("never reads the wallet without paid features and Zinc connected", async () => {
    const zinc = zincFake();
    const h = funded(zinc, false);
    await h.tick("2027-02-11");
    expect(zinc.wallet).not.toHaveBeenCalled();
    expect(h.emails[0].text).not.toContain("Zinc");
  });

  it("warns when the next weeks' gifts are more than the balance, with the top-up link", async () => {
    const zinc = zincFake();
    const h = funded(zinc, true);
    await h.tick("2027-02-11");
    expect(zinc.lookahead).toHaveBeenCalledWith(USER, 21, 100);
    expect(h.emails[0].text).toContain("Your Zinc balance is low. $160 in gifts are due in the next 3 weeks, and you have $40.");
    expect(h.emails[0].text).toContain("Top up your Zinc balance: https://zinc.test/wallet");
  });

  it("says nothing when auto top-up is on, the balance covers it, or Zinc fails", async () => {
    for (const zinc of [
      zincFake({ wallet: vi.fn(async () => ({ balanceCents: 4000, autoTopUp: true })) }),
      zincFake({ wallet: vi.fn(async () => ({ balanceCents: 20000, autoTopUp: false })) }),
      zincFake({ wallet: vi.fn(async () => ({ balanceCents: null, autoTopUp: false })) }),
      zincFake({ lookahead: vi.fn(async () => Promise.reject(new Error("down"))) }),
    ]) {
      const h = funded(zinc, true);
      await h.tick("2027-02-11");
      expect(h.sent()).toEqual(["heads_up@2027-02-11"]);
      expect(h.emails[0].text).not.toContain("Zinc balance is low");
    }
  });
});

describe("runTick: clearing unfiled notes (ALL-31)", () => {
  it("runs the clear-out, with the engine on or off, and logs how many it cleared", async () => {
    for (const on of [1, 0]) {
      const h = harness();
      h.store.settings.set("round_engine_enabled", on);
      const clear = vi.fn(async () => ({ cleared: 2, imagesRemoved: 1 }));
      await runTick({ ...h.deps(at("2027-01-01")), clearUnfiledNotes: clear });
      expect(clear).toHaveBeenCalledTimes(1);
    }
    expect(named("inbound.notes_cleared")).toEqual([
      expect.objectContaining({ cleared: 2, imagesRemoved: 1 }),
      expect.objectContaining({ cleared: 2, imagesRemoved: 1 }),
    ]);
  });

  it("logs a failed clear-out and still runs the rest of the tick", async () => {
    const h = harness();
    const clear = vi.fn(async () => {
      throw new Error("storage down for someone@example.com");
    });
    h.store.candidateRows = [
      { userId: USER, personId: PERSON, occasionId: OCCASION, rule: { kind: "birthday", month: 3, day: 20 }, budgetCents: 5000 },
    ];
    const summary = await runTick({ ...h.deps(at("2027-02-11")), clearUnfiledNotes: clear });

    expect(summary).toMatchObject({ enabled: true, created: 1, failed: 0 });
    const failed = named("inbound.notes_clear_failed");
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed)).not.toContain("someone@example.com");
  });

  it("does nothing when no clear-out is wired", async () => {
    const h = harness();
    await expect(runTick(h.deps(at("2027-01-01")))).resolves.toMatchObject({ enabled: true });
    expect(named("inbound.notes_clear_failed")).toHaveLength(0);
  });
});

describe("runTick: pruning expired action links", () => {
  it("runs the prune, with the engine on or off, and logs how many it deleted", async () => {
    for (const on of [1, 0]) {
      const h = harness();
      h.store.settings.set("round_engine_enabled", on);
      const prune = vi.fn(async () => 3);
      await runTick({ ...h.deps(at("2027-01-01")), pruneActionLinks: prune });
      expect(prune).toHaveBeenCalledTimes(1);
    }
    expect(named("housekeeping.action_links_pruned")).toEqual([
      expect.objectContaining({ deleted: 3 }),
      expect.objectContaining({ deleted: 3 }),
    ]);
  });

  it("logs a failed prune and still runs the clear-out and the rest of the tick", async () => {
    const h = harness();
    const prune = vi.fn(async () => {
      throw new Error("db down for someone@example.com");
    });
    const clear = vi.fn(async () => ({ cleared: 1, imagesRemoved: 0 }));
    h.store.candidateRows = [
      { userId: USER, personId: PERSON, occasionId: OCCASION, rule: { kind: "birthday", month: 3, day: 20 }, budgetCents: 5000 },
    ];
    const summary = await runTick({ ...h.deps(at("2027-02-11")), clearUnfiledNotes: clear, pruneActionLinks: prune });

    expect(summary).toMatchObject({ enabled: true, created: 1, failed: 0 });
    expect(clear).toHaveBeenCalledTimes(1);
    const failed = named("housekeeping.action_links_prune_failed");
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed)).not.toContain("someone@example.com");
    expect(named("inbound.notes_cleared")).toHaveLength(1);
  });

  it("still prunes when the clear-out fails", async () => {
    const h = harness();
    const prune = vi.fn(async () => 0);
    const clear = vi.fn(async () => Promise.reject(new Error("storage down")));
    await runTick({ ...h.deps(at("2027-01-01")), clearUnfiledNotes: clear, pruneActionLinks: prune });
    expect(prune).toHaveBeenCalledTimes(1);
    expect(named("housekeeping.action_links_pruned")).toEqual([expect.objectContaining({ deleted: 0 })]);
  });
});

describe("runTick: the daily tracking news (ALL-33)", () => {
  it("runs the news, with the engine on or off, and logs how many emails went out", async () => {
    for (const on of [1, 0]) {
      const h = harness();
      h.store.settings.set("round_engine_enabled", on);
      const news = vi.fn(async () => ({ sent: 2 }));
      await runTick({ ...h.deps(at("2027-01-01")), trackingNews: news });
      expect(news).toHaveBeenCalledTimes(1);
    }
    expect(named("tracking.news_run")).toEqual([expect.objectContaining({ sent: 2 }), expect.objectContaining({ sent: 2 })]);
  });

  it("a failed news run is logged as an alert and the rest of the tick still runs", async () => {
    const h = harness();
    const news = vi.fn(async () => Promise.reject(new Error("db down for someone@example.com")));
    h.store.candidateRows = [
      { userId: USER, personId: PERSON, occasionId: OCCASION, rule: { kind: "birthday", month: 3, day: 20 }, budgetCents: 5000 },
    ];
    const summary = await runTick({ ...h.deps(at("2027-02-11")), trackingNews: news });
    expect(summary).toMatchObject({ enabled: true, created: 1, failed: 0 });
    const failed = named("tracking.news_run_failed");
    expect(failed).toEqual([expect.objectContaining({ alert: true })]);
    expect(JSON.stringify(failed)).not.toContain("someone@example.com");
  });
});

describe("runTick: pruning old tracking numbers", () => {
  it("prune step runs and logs, with the engine on or off", async () => {
    for (const on of [1, 0]) {
      const h = harness();
      h.store.settings.set("round_engine_enabled", on);
      const prune = vi.fn(async () => 4);
      await runTick({ ...h.deps(at("2027-01-01")), pruneTrackingNumbers: prune });
      expect(prune).toHaveBeenCalledTimes(1);
    }
    expect(named("housekeeping.tracking_pruned")).toEqual([
      expect.objectContaining({ cleared: 4 }),
      expect.objectContaining({ cleared: 4 }),
    ]);
  });

  it("logs a failed prune without personal data and still runs the rest of the tick", async () => {
    const h = harness();
    const prune = vi.fn(async () => {
      throw new Error("db down for someone@example.com");
    });
    const actionPrune = vi.fn(async () => 0);
    await expect(
      runTick({ ...h.deps(at("2027-01-01")), pruneTrackingNumbers: prune, pruneActionLinks: actionPrune }),
    ).resolves.toMatchObject({ enabled: true });
    expect(actionPrune).toHaveBeenCalledTimes(1);
    const failed = named("housekeeping.tracking_prune_failed");
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed)).not.toContain("someone@example.com");
  });
});
