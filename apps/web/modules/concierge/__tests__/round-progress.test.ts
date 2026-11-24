import { describe, expect, it } from "vitest";
import { holdState, roundOutcome, waitingOn } from "../rounds/outcome";
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
  deliveredAt: null,
  ...over,
});
type Extra = Partial<Parameters<typeof progressLine>[2]>;
const line = (r: ProgressRound, orders: ProgressOrder[] = [], o: Extra = {}) =>
  progressLine(r, orders, { waiting: null, readyIdeas: 0, hold: holdOf(r, orders), today: TODAY, leaveAfterDays: 14, ...o });
/** With nothing known about the address: what a hold for one says then. */
const holdOf = (r: ProgressRound, orders: ProgressOrder[]) =>
  orders.some((o) => o.status === "held") ? holdState(r.attentionReason, { shared: false, own: false, rejected: false, toPerson: true }) : null;
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

describe("what a hold waits on", () => {
  const none = { shared: false, own: false, rejected: false, toPerson: true };
  it.each([
    ["funds", none, "funds", "Waiting on your Zinc balance", true],
    ["setup", none, "setup", "Waiting on payment setup", true],
    ["address", none, "address", "Needs an address", true],
    // The daily look places a hold for an address someone now shares.
    ["address", { ...none, shared: true }, "waiting", "Waiting to order", false],
    ["address", { ...none, shared: true, rejected: true }, "waiting", "Waiting to order", false],
    // Their own address is placed only by saving it, so one that's here still needs the buyer.
    ["address", { ...none, own: true }, "check_address", "Check the address", true],
    // The store couldn't use it, however well formed it is.
    ["address", { ...none, own: true, rejected: true }, "address", "Needs an address", true],
    // Going to the buyer or somewhere else: a person's address can't help it.
    ["address", { ...none, own: true, shared: true, toPerson: false }, "cancel_only", "Needs an address", true],
    ["address", null, "waiting", "Waiting to order", false],
    ["paused", none, "waiting", "Waiting to order", false],
    ["unconfirmed", none, "waiting", "Waiting to order", false],
    [null, none, "waiting", "Waiting to order", false],
  ] as const)("%s, %o: %s", (reason, address, kind, says, needsBuyer) => {
    const hold = holdState(reason, address);
    expect(hold).toEqual({ kind, text: says });
    expect(line(HELD(reason), [order("held")], { hold })).toMatchObject({ text: says, needsBuyer });
  });

  it("next to one being confirmed, Confirming your order wins: which hold it is can't be read", () => {
    for (const orders of [[order("held"), order("unconfirmed")], [order("unconfirmed"), order("held")]]) {
      expect(text(HELD("unconfirmed"), orders)).toBe("Confirming your order");
    }
  });
});

describe("a read that failed", () => {
  it("says only what's still true", () => {
    expect(text(round(), [], { readyIdeas: "some" })).toBe("Ideas ready · Choose by Tue, Dec 15");
    expect(text(round(), [], { readyIdeas: "unknown" })).toBe("Choose by Tue, Dec 15");
    expect(line(round({ status: "needs_address" }), [], { waiting: "unknown" })).toEqual({ text: "No ideas yet", tone: "muted", needsBuyer: false });
  });
});

describe("rows leave", () => {
  const on = (today: string, orders: ProgressOrder[], status = "ordered") => text(round({ status }), orders, { today, leaveAfterDays: 14 });
  // The occasion is Dec 25.
  it.each([
    ["occasion, no due day", [order("placed")], "2027-01-07", "2027-01-08"],
    ["occasion after the due day", [order("shipped", { estDeliveryDate: "2026-12-14" })], "2027-01-07", "2027-01-08"],
    ["due day after the occasion", [order("shipped", { estDeliveryDate: "2026-12-27" })], "2027-01-09", "2027-01-10"],
    ["one delivered, one not", [order("delivered", { deliveredAt: "2026-12-30T01:00:00Z" }), order("shipped")], "2027-01-12", "2027-01-13"],
  ])("%s", (_what, orders, last, gone) => {
    expect(on(last, orders)).not.toBeNull();
    expect(on(gone, orders)).toBeNull();
  });

  it("a delivered round, that long after it was delivered", () => {
    const delivered = [order("delivered", { deliveredAt: "2026-12-10T23:00:00Z" }), order("delivered", { deliveredAt: "2026-12-12T01:00:00Z" })];
    expect(on("2026-12-25", delivered, "delivered")).toBe("Delivered");
    expect(on("2026-12-26", delivered, "delivered")).toBeNull();
    // No day recorded: counted from the occasion.
    expect(on("2027-01-07", [order("delivered")], "delivered")).toBe("Delivered");
  });

  it.each(["placing", "unconfirmed"])("never one still %s", (status) => {
    expect(on("2027-06-01", [order(status), order("placed")])).toBe("Confirming your order");
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

  it("a finished round with a shipped and a cancelled gift shows the shipped one", () => {
    expect(text(round({ status: "skipped" }), [order("cancelled"), order("shipped", { estDeliveryDate: "2026-12-14" })])).toBe("Shipped · due Mon, Dec 14");
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

describe("a round a date change ended (T92)", () => {
  const ended = round({ status: "skipped", closedAt: "2026-12-09T00:00:00Z", occasionYear: null });
  it.each([
    ["no orders", []],
    ["a failed gift, dealt with at the close", [order("failed", { resolved: true })]],
    ["a gift the store cancelled", [order("failed", { failureType: "store_cancelled", resolved: true })]],
  ])("with %s leaves, and the page says why on any day", (_what, orders) => {
    for (const today of [TODAY, "2026-12-16", "2026-12-26"]) {
      expect(line(ended, orders, { readyIdeas: 3, today })).toBeNull();
      expect(roundOutcome(ended, orders, today).closed).toBe("moved");
    }
  });
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
