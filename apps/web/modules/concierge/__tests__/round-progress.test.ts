import { describe, expect, it } from "vitest";
import { roundOutcome, waitingOn } from "../rounds/outcome";
import { byNeed, progressLine, type ProgressOrder, type ProgressRound } from "../rounds/progress";

// Christmas (Fri, Dec 25 2026), ship by Dec 16, looked at on Dec 10 unless a test says otherwise.
const TODAY = "2026-12-10";
const round = (over: Partial<ProgressRound> = {}): ProgressRound => ({
  status: "awaiting_approval",
  attentionReason: null,
  closedAt: null,
  shipBy: "2026-12-16",
  occasionDate: "2026-12-25",
  occasionYear: 2026,
  ...over,
});
const order = (status: string, over: Partial<ProgressOrder> = {}): ProgressOrder => ({
  status,
  failureType: null,
  resolved: false,
  estDeliveryDate: null,
  placedAt: "2026-12-08T12:00:00Z",
  handlingDaysMax: null,
  deliveryDaysMax: null,
  ...over,
});
type Extra = { waiting?: "looking" | "told" | "address" | null; readyIdeas?: number; today?: string };
const line = (r: ProgressRound, orders: ProgressOrder[] = [], o: Extra = {}) =>
  progressLine(r, orders, { waiting: o.waiting ?? null, readyIdeas: o.readyIdeas ?? 0, today: o.today ?? TODAY });
const text = (...a: Parameters<typeof line>) => line(...a)?.text ?? null;

const HELD = (attentionReason: string | null) => round({ status: "needs_attention", attentionReason });
const ORDERED = round({ status: "ordered" });

describe("a round still looking for ideas", () => {
  it.each([
    ["looking", "Looking for ideas", "muted", false],
    ["told", "No ideas found yet", "warn", true],
    ["address", "Needs an address", "warn", true],
  ] as const)("%s", (waiting, says, tone, needsBuyer) => {
    for (const status of ["scheduled", "generating", "needs_address"]) {
      expect(line(round({ status }), [], { waiting })).toEqual({ text: says, tone, needsBuyer });
    }
  });

  it("shows nothing when there's nothing to say (no paid features)", () => {
    expect(line(round({ status: "generating" }))).toBeNull();
  });
});

describe("what it waits on", () => {
  const base = { status: "needs_address", paid: true, hasAddress: true, toldAt: null, ideasFoundAt: [] as string[] };
  it.each([
    [{}, "looking"],
    [{ paid: false }, null],
    [{ hasAddress: false }, "address"],
    // The status only moves at the next daily look, so a generating round had its address.
    [{ status: "generating", hasAddress: false }, "looking"],
    [{ toldAt: "2026-12-02T12:00:00Z" }, "told"],
    [{ toldAt: "2026-12-02T12:00:00Z", hasAddress: false }, "address"],
    [{ toldAt: "2026-12-02T12:00:00Z", ideasFoundAt: ["2026-12-01T12:00:00Z"] }, "told"],
    [{ toldAt: "2026-12-02T12:00:00Z", ideasFoundAt: ["2026-12-03T12:00:00Z"] }, "looking"],
    [{ status: "awaiting_approval" }, null],
  ] as const)("%o is %s", (over, says) => {
    expect(waitingOn({ ...base, ...over, ideasFoundAt: [...("ideasFoundAt" in over ? over.ideasFoundAt : [])] })).toBe(says);
  });
});

describe("a round waiting for a choice", () => {
  it("counts the ideas and says when to choose by, the day before ship-by", () => {
    expect(line(round(), [], { readyIdeas: 3 })).toEqual({ text: "3 ideas ready · Choose by Tue, Dec 15", tone: "ready", needsBuyer: true });
    expect(text(round(), [], { readyIdeas: 1 })).toBe("1 idea ready · Choose by Tue, Dec 15");
  });

  it("with every idea taken it never says ideas are ready", () => {
    expect(line(round(), [], { readyIdeas: 0 })).toEqual({ text: "No ideas left", tone: "warn", needsBuyer: true });
  });

  it.each(["2026-12-16", "2026-12-20", "2026-12-30"])("on %s it's too late, so it's gone", (today) => {
    expect(line(round(), [], { readyIdeas: 3, today })).toBeNull();
  });

  it.each([{ closedAt: "2026-12-09T00:00:00Z" }, { status: "skipped" }, { status: "complete" }])("%o is over", (over) => {
    expect(line(round(over), [], { readyIdeas: 3 })).toBeNull();
  });
});

describe("a held gift", () => {
  it.each([
    ["funds", "Waiting on your Zinc balance"],
    ["setup", "Waiting on payment setup"],
    ["address", "Needs an address"],
  ])("%s", (reason, says) => {
    expect(line(HELD(reason), [order("held")])).toEqual({ text: says, tone: "warn", needsBuyer: true });
  });

  it.each(["paused", "retry", "not_allowed"])("%s is ours to sort out", (reason) => {
    expect(line(HELD(reason), [order("held")])).toEqual({ text: "Waiting to order", tone: "muted", needsBuyer: false });
  });

  it("is gone from the ship-by day, when it can only be cancelled", () => {
    expect(line(HELD("funds"), [order("held")], { today: "2026-12-16" })).toBeNull();
  });
});

describe("a failed gift", () => {
  it.each(["price_up", "out_of_stock", "too_late", "failed"])("%s needs a fix, with the day to choose by", (reason) => {
    expect(line(HELD(reason), [order("failed", { failureType: reason })])).toEqual({
      text: "Needs a fix · Choose by Tue, Dec 15",
      tone: "warn",
      needsBuyer: true,
    });
  });

  it("one already dealt with says nothing", () => {
    expect(text(ORDERED, [order("failed", { resolved: true }), order("placed")])).toBe("Ordered");
  });

  it("is gone from the ship-by day", () => {
    expect(line(HELD("failed"), [order("failed")], { today: "2026-12-16" })).toBeNull();
  });
});

describe("a gift on its way", () => {
  it.each(["placing", "unconfirmed"])("%s is never called ordered", (status) => {
    const r = status === "placing" ? ORDERED : HELD("unconfirmed");
    expect(line(r, [order(status)])).toEqual({ text: "Confirming your order", tone: "muted", needsBuyer: false });
  });

  it("ordered, shipped and delivered", () => {
    expect(line(ORDERED, [order("placed")])).toEqual({ text: "Ordered", tone: "muted", needsBuyer: false });
    expect(text(ORDERED, [order("shipped", { estDeliveryDate: "2026-12-14" })])).toBe("Shipped · due Mon, Dec 14");
    expect(text(ORDERED, [order("shipped")])).toBe("Shipped");
    expect(text(round({ status: "delivered" }), [order("delivered")])).toBe("Delivered");
  });

  it("late means after the occasion", () => {
    expect(line(ORDERED, [order("shipped", { estDeliveryDate: "2026-12-27" })])).toEqual({
      text: "May arrive late · due Sun, Dec 27",
      tone: "warn",
      needsBuyer: false,
    });
    expect(text(ORDERED, [order("shipped", { estDeliveryDate: "2026-12-25" })])).toBe("Shipped · due Fri, Dec 25");
    // Without a carrier date, the store's own range.
    expect(text(ORDERED, [order("placed", { handlingDaysMax: 5, deliveryDaysMax: 14 })])).toBe("May arrive late · due Sun, Dec 27");
  });

  it("a day that has passed is never still due", () => {
    expect(text(ORDERED, [order("shipped", { estDeliveryDate: "2026-12-14" })], { today: "2026-12-15" })).toBe("Shipped · was due Mon, Dec 14");
    expect(text(ORDERED, [order("shipped", { estDeliveryDate: "2026-12-14" })], { today: "2026-12-14" })).toBe("Shipped · due Mon, Dec 14");
    expect(text(ORDERED, [order("shipped", { estDeliveryDate: "2026-12-27" })], { today: "2026-12-28" })).toBe("Shipped · was due Sun, Dec 27");
    expect(text(ORDERED, [order("placed", { handlingDaysMax: 5, deliveryDaysMax: 14 })], { today: "2026-12-28" })).toBe("Ordered");
  });

  it("shows after ship-by, after the occasion and once the round is closed or skipped", () => {
    expect(text(ORDERED, [order("placed")], { today: "2026-12-30" })).toBe("Ordered");
    expect(text(round({ status: "ordered", closedAt: "2026-12-09T00:00:00Z" }), [order("placed")])).toBe("Ordered");
    expect(text(round({ status: "skipped" }), [order("shipped")])).toBe("Shipped");
    expect(text(round({ status: "needs_attention", closedAt: "2026-12-09T00:00:00Z" }), [order("unconfirmed")])).toBe("Confirming your order");
  });

  it("is delivered until the round is complete", () => {
    for (const status of ["complete", "skipped"]) expect(line(round({ status }), [order("delivered")])).toBeNull();
  });

  it.each(["cancelled", "refunded"])("a %s gift isn't on its way", (status) => {
    expect(line(ORDERED, [order(status)])).toBeNull();
  });
});

describe("several gifts", () => {
  const shipped = order("shipped", { estDeliveryDate: "2026-12-14" });
  it.each([
    ["a hold beats a failure", HELD("funds"), [order("held"), order("failed")], "Waiting on your Zinc balance"],
    ["a failure beats one on its way", HELD("failed"), [order("failed"), shipped], "Needs a fix · Choose by Tue, Dec 15"],
    ["a failure beats one being confirmed", HELD("unconfirmed"), [order("unconfirmed"), order("failed")], "Needs a fix · Choose by Tue, Dec 15"],
    ["late beats ordered", ORDERED, [order("placed"), order("shipped", { estDeliveryDate: "2026-12-27" })], "May arrive late · due Sun, Dec 27"],
    ["the latest late date", ORDERED, [order("shipped", { estDeliveryDate: "2026-12-28" }), order("shipped", { estDeliveryDate: "2026-12-27" })], "May arrive late · due Mon, Dec 28"],
    ["one being confirmed beats ordered", ORDERED, [order("placing"), order("placed")], "Confirming your order"],
    ["a hold of ours beats ordered", HELD("paused"), [order("held"), order("placed")], "Waiting to order"],
    ["never Shipped while one is only ordered", ORDERED, [shipped, order("placed")], "Ordered"],
    ["never Delivered while one is shipped", ORDERED, [order("delivered"), shipped], "Shipped · due Mon, Dec 14"],
    ["the last day of two shipped", ORDERED, [shipped, order("shipped", { estDeliveryDate: "2026-12-18" })], "Shipped · due Fri, Dec 18"],
    ["no due day unless both have one", ORDERED, [shipped, order("shipped")], "Shipped"],
  ])("%s", (_what, r, orders, says) => {
    expect(text(r, orders)).toBe(says);
    expect(text(r, [...orders].reverse())).toBe(says);
  });

  it.each([
    ["delivered", order("held")],
    ["delivered", order("failed")],
    ["shipped", order("failed")],
  ])("past ship-by, a %s gift next to an unfinished one only says ordered", (status, other) => {
    expect(text(HELD("failed"), [order(status), other], { today: "2026-12-17" })).toBe("Ordered");
  });
});

it("an attention round with nothing it can name still shows", () => {
  expect(line(HELD(null), [order("refunded")])).toEqual({ text: "Needs a look", tone: "warn", needsBuyer: true });
});

describe("the round page's rules", () => {
  it.each([
    [ORDERED, [order("placing")], "ordered"],
    [HELD("unconfirmed"), [order("unconfirmed")], null],
    [round({ closedAt: "x" }), [order("placing")], "confirming"],
    [round({ status: "skipped" }), [], "stopped"],
    [round({ status: "skipped" }), [order("refunded")], "none_coming"],
  ])("%o with %o", (r, orders, closed) => {
    expect(roundOutcome(r, orders, TODAY).closed).toBe(closed);
  });

  it("past the ship-by day and past the occasion", () => {
    expect(roundOutcome(round(), [], "2026-12-16").closed).toBe("too_late");
    expect(roundOutcome(round(), [], "2026-12-26").closed).toBe("passed");
  });
});

describe("order on Home", () => {
  const row = (roundId: string, needsBuyer: boolean, date: string, personName = "Ann") => ({
    roundId,
    personName,
    date,
    line: { text: "", tone: "muted" as const, needsBuyer },
  });
  it("needs the buyer first, then the nearest date, then the name, then the id", () => {
    const rows = [
      row("5", false, "2026-12-01"),
      row("4", true, "2026-12-20"),
      row("3", true, "2026-12-15", "Zed"),
      row("2", true, "2026-12-15", "Bob"),
      row("1", true, "2026-12-15", "Bob"),
    ];
    expect(rows.sort(byNeed).map((r) => r.roundId)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
