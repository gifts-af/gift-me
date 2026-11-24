import { describe, expect, it, vi } from "vitest";
import { advanceRound, runTick } from "../rounds/engine";
import { harness, events, named, captureLog, at } from "./round-engine-fakes";

vi.mock("server-only", () => ({}));

// A date change ends a round while the engine is working on it: nothing more is sent or bought
// for it, and it isn't a failure. Against fake stores; moved-dates-db.test.ts has the real locks.

captureLog();

type H = ReturnType<typeof harness>;
/** Moves the date just before the engine's next call to `method`. */
function moveBefore(h: H, method: "holdsLease" | "finish" | "release" | "sentSteps") {
  const real = h.store[method].bind(h.store) as (...args: unknown[]) => Promise<unknown>;
  vi.spyOn(h.store, method).mockImplementationOnce((async (...args: unknown[]) => {
    h.store.endByMove(h.store.rounds[0].id);
    return real(...args);
  }) as never);
}
const quiet = (h: H, result: { failed: number }) => {
  expect(result.failed).toBe(0);
  expect(named("round_failed")).toEqual([]);
  const logged = named("round_ended_by_move");
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatchObject({ round_id: h.store.rounds[0].id, user_id: h.store.rounds[0].userId });
  expect(events().some((e) => e.alert === true)).toBe(false);
  expect(h.store.rounds[0].status).toBe("skipped");
};

describe("a round ended by a date change, mid-step", () => {
  it("AC-9: no heads-up starts after the move, and none is recorded", async () => {
    const h = harness();
    moveBefore(h, "holdsLease");
    quiet(h, await h.tick("2027-02-11"));
    expect(h.emails).toEqual([]);
    expect([...(h.store.sends.get(h.store.rounds[0].id) ?? [])]).toEqual([]);
  });

  it("AC-9: no address request", async () => {
    const h = harness({ hasAddress: false });
    moveBefore(h, "holdsLease");
    quiet(h, await h.tick("2027-02-11"));
    expect(h.emails).toEqual([]);
  });

  it("AC-9: no no_ideas email", async () => {
    const h = harness();
    h.store.ideaState.set("round-1", { hasFacts: false, hasListGifts: false, ideaRunsLeft: true });
    moveBefore(h, "holdsLease");
    quiet(h, await h.tick("2027-02-11"));
    expect(h.emails).toEqual([]);
  });

  it("AC-9: no reminder", async () => {
    const h = harness();
    await h.tick("2027-02-11");
    const before = h.emails.length;
    moveBefore(h, "holdsLease");
    quiet(h, await h.tick("2027-02-16"));
    expect(h.emails.length).toBe(before);
  });

  it("AC-9: no run is bought for a round that ended before it", async () => {
    const h = harness();
    moveBefore(h, "finish");
    quiet(h, await h.tick("2027-02-11"));
    expect(h.generateIdeas).not.toHaveBeenCalled();
  });

  it("AC-9: a run the database refused as closed ends quietly", async () => {
    const h = harness();
    h.generateIdeas.mockImplementationOnce(async (round) => {
      h.store.endByMove(round.id);
      return { status: "refused", reason: "closed" };
    });
    quiet(h, await h.tick("2027-02-11"));
    expect(h.emails).toEqual([]);
  });

  it("AC-9: a run that saved nothing because the round ended sends nothing", async () => {
    const h = harness();
    h.generateIdeas.mockImplementationOnce(async (round) => {
      h.store.endByMove(round.id);
      return { status: "none" };
    });
    quiet(h, await h.tick("2027-02-11"));
    expect(h.emails).toEqual([]);
  });

  it("AC-9: a run that was paid for still uses the tick's turn", async () => {
    const h = harness();
    h.store.settings.set("idea_rounds_per_tick", 1);
    h.store.people.set("person-2", { name: "Other", hasAddress: true });
    h.store.occasionKinds.set("occasion-2", "birthday");
    h.today = "2027-02-11";
    const rule = { kind: "birthday" as const, month: 3, day: 20 };
    h.store.candidateRows = [
      { userId: "user-1", personId: "person-1", occasionId: "occasion-1", rule, budgetCents: 5000 },
      { userId: "user-1", personId: "person-2", occasionId: "occasion-2", rule, budgetCents: null },
    ];
    h.generateIdeas.mockImplementationOnce(async (round) => {
      h.store.endByMove(round.id);
      return { status: "none" };
    });
    await runTick(h.deps(at("2027-02-11")));
    expect(h.generateIdeas).toHaveBeenCalledTimes(1);
  });

  it("releasing an ended round isn't a failed release", async () => {
    const h = harness();
    h.generateIdeas.mockImplementationOnce(async (round) => {
      h.store.endByMove(round.id);
      return { status: "refused", reason: "busy" };
    });
    quiet(h, await h.tick("2027-02-11"));
    expect(named("round_release_failed")).toEqual([]);
  });

  it("a just-placed check finds it ended and says busy", async () => {
    const h = harness();
    await h.tick("2027-02-11");
    moveBefore(h, "release");
    expect(await advanceRound("round-1", h.deps(at("2027-02-12")), { justPlaced: true })).toBe("busy");
    expect(named("round_ended_by_move")).toHaveLength(1);
  });

  it("a lease lost any other way is still a failure", async () => {
    const h = harness();
    vi.spyOn(h.store, "holdsLease").mockResolvedValueOnce(false);
    expect((await h.tick("2027-02-11")).failed).toBe(1);
    expect(named("round_failed")).toHaveLength(1);
    expect(named("round_ended_by_move")).toEqual([]);
  });
});
