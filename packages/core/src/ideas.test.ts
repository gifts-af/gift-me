import { describe, expect, it } from "vitest";
import {
  appliedBudget,
  canAffordRank,
  ideaRunWorstMs,
  judgeCandidate,
  keepIdeas,
  matchHit,
  mentionsName,
  onDemandOccasion,
  pickOffer,
  redactNames,
  type JudgeContext,
  type ZincOffer,
} from "./ideas";
import { ideaRunNotice, IDEA_RUN_OFF } from "./paid-features";
import type { ScheduleSettings } from "./schedule";

const s: ScheduleSettings = {
  planningDeliveryDays: 7,
  safetyBufferDays: 2,
  roundLeadDays: 28,
  reminder1AfterHeadsUpDays: 5,
  reminder2BeforeDeadlineDays: 7,
  finalNoticeBeforeDeadlineDays: 2,
  fastestDaysToArrive: 1,
  holdReminderDays: 7,
  holdFinalDays: 2,
};

const offer = (o: Partial<ZincOffer> = {}): ZincOffer => ({
  offerId: "o1",
  priceCents: 2000,
  shippingCents: 500,
  available: true,
  condition: "New",
  buyBox: false,
  firstParty: false,
  sellerName: null,
  handlingDaysMax: 1,
  deliveryDaysMin: 2,
  deliveryDaysMax: 4,
  ...o,
});

const ctx = (c: Partial<JudgeContext> = {}): JudgeContext => ({
  budgetCents: 3000,
  overBudgetPct: 20,
  taxPct: 8,
  feeCents: 100,
  occasionDate: "2026-12-25",
  orderDate: "2026-12-01",
  excluded: new Set(),
  maxTotalCents: null,
  ...c,
});

describe("matchHit", () => {
  const hits = [
    { productId: "a", title: "Acme Rod", priceCents: 1 },
    { productId: "b", title: "Zeta Reel", priceCents: 2 },
  ];
  it("picks the first hit whose title contains the brand, ignoring case", () => {
    expect(matchHit(hits, "zeta")?.productId).toBe("b");
  });
  it("returns null when no brand matches", () => {
    expect(matchHit(hits, "nope")).toBeNull();
  });
  it("takes the first hit when there's no brand", () => {
    expect(matchHit(hits, null)?.productId).toBe("a");
    expect(matchHit([], null)).toBeNull();
  });
});

describe("pickOffer", () => {
  it("never picks used or refurbished, even when cheaper", () => {
    const picked = pickOffer([
      offer({ offerId: "used", condition: "Used", priceCents: 1 }),
      offer({ offerId: "ref", condition: "Refurbished", priceCents: 1 }),
      offer({ offerId: "new", priceCents: 9000 }),
    ]);
    expect(picked?.offerId).toBe("new");
    expect(pickOffer([offer({ condition: "Used" })])).toBeNull();
  });
  it("prefers buy box, then first party, then fastest delivery", () => {
    expect(pickOffer([offer({ offerId: "x", firstParty: true }), offer({ offerId: "bb", buyBox: true })])?.offerId).toBe("bb");
    expect(pickOffer([offer({ offerId: "x", deliveryDaysMax: 1 }), offer({ offerId: "fp", firstParty: true })])?.offerId).toBe("fp");
    expect(pickOffer([offer({ offerId: "slow", deliveryDaysMax: 9 }), offer({ offerId: "fast", deliveryDaysMax: 2 })])?.offerId).toBe("fast");
  });
  it("skips unavailable offers", () => {
    expect(pickOffer([offer({ available: false, buyBox: true })])).toBeNull();
  });
});

describe("judgeCandidate", () => {
  const cand = (o: Partial<ZincOffer> = {}) => ({ productId: "p1", offer: offer(o) });
  it("totals with the flat tax", () => {
    const r = judgeCandidate(cand(), ctx({ budgetCents: 5000 }), s);
    expect(r).toEqual({ keep: true, totalCents: 2760, fit: "within", arriveBy: "2026-12-06" });
  });
  it("drops a late arrival", () => {
    const r = judgeCandidate(cand(), ctx({ orderDate: "2026-12-22" }), s);
    expect(r).toEqual({ keep: false, reason: "late" });
  });
  it("skips the arrival check without an occasion date", () => {
    const r = judgeCandidate(cand(), ctx({ occasionDate: null, orderDate: "2026-12-22" }), s);
    expect(r).toMatchObject({ keep: true, arriveBy: null });
  });
  it("marks over budget, and drops past the limit", () => {
    expect(judgeCandidate(cand(), ctx({ budgetCents: 2500 }), s)).toMatchObject({ keep: true, fit: "over" });
    expect(judgeCandidate(cand(), ctx({ budgetCents: 2000 }), s)).toEqual({ keep: false, reason: "over_limit" });
  });
  it("never says over budget with no budget", () => {
    expect(judgeCandidate(cand(), ctx({ budgetCents: null }), s)).toMatchObject({ keep: true, fit: "within" });
  });
  it("drops excluded products as given_or_rejected", () => {
    expect(judgeCandidate(cand(), ctx({ excluded: new Set(["p1"]) }), s)).toEqual({ keep: false, reason: "given_or_rejected" });
  });
  it("judgeCandidate drops a total at or above maxTotalCents", () => {
    // 2000 + 500 shipping + 160 tax + 100 fee = 2760.
    expect(judgeCandidate(cand(), ctx({ maxTotalCents: 2760 }), s)).toEqual({ keep: false, reason: "over_limit" });
    expect(judgeCandidate(cand(), ctx({ maxTotalCents: 2761 }), s)).toMatchObject({ keep: true, totalCents: 2760 });
    expect(judgeCandidate(cand(), ctx({ maxTotalCents: null }), s)).toMatchObject({ keep: true });
  });
  it("drops an unavailable offer", () => {
    expect(judgeCandidate(cand({ available: false }), ctx(), s)).toEqual({ keep: false, reason: "unavailable" });
  });
});

describe("keepIdeas", () => {
  it("keeps up to keepMax within budget, plus the first over budget", () => {
    const ranked = [
      { id: 1, fit: "within" as const },
      { id: 2, fit: "over" as const },
      { id: 3, fit: "within" as const },
      { id: 4, fit: "within" as const },
      { id: 5, fit: "over" as const },
    ];
    expect(keepIdeas(ranked, 2).map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe("redactNames", () => {
  it("replaces whole words only, in any case", () => {
    expect(redactNames("Bob loves fishing", ["bob"])).toBe("them loves fishing");
    expect(redactNames("Al is always here", ["Al"])).toBe("them is always here");
  });
  it("ignores names under 2 letters", () => {
    expect(redactNames("A big day", ["A"])).toBe("A big day");
  });
});

describe("mentionsName", () => {
  it("finds a whole-word name", () => {
    expect(mentionsName("Gift for BOB", ["Bob"])).toBe(true);
    expect(mentionsName("bobcat", ["Bob"])).toBe(false);
  });
});

describe("appliedBudget", () => {
  it("is own, else base, else default, else null", () => {
    expect(appliedBudget(1, 2, 3)).toBe(1);
    expect(appliedBudget(null, 2, 3)).toBe(2);
    expect(appliedBudget(null, null, 3)).toBe(3);
    expect(appliedBudget(null, null, null)).toBeNull();
  });
});

describe("onDemandOccasion", () => {
  it("picks the next occasion an order today can reach, else null", () => {
    const occ = [
      { date: "2026-12-30", ownBudgetCents: 5 },
      { date: "2026-11-18", ownBudgetCents: null },
      { date: "2026-12-10", ownBudgetCents: 7 },
    ];
    expect(onDemandOccasion(occ, "2026-11-17", s)).toEqual({ date: "2026-12-10", ownBudgetCents: 7 });
    expect(onDemandOccasion([{ date: "2026-11-18", ownBudgetCents: null }], "2026-11-17", s)).toBeNull();
    expect(onDemandOccasion([], "2026-11-17", s)).toBeNull();
  });
});

describe("idea run cost", () => {
  it("ideaRunWorstMs counts the list pass", () => {
    // Brainstorm and resolve: 2*ai + 2*zinc. List pass: 10 lookups at 10 a second plus one
    // Zinc timeout. Photos: one more Zinc timeout.
    expect(ideaRunWorstMs(60000, 15000, 10, 10)).toBe(150000 + 1000 + 15000 + 15000);
    // A fractional rate rounds the list pass up to a whole millisecond.
    expect(ideaRunWorstMs(60000, 15000, 10, 3)).toBe(150000 + 3334 + 15000 + 15000);
  });
  it("canAffordRank", () => {
    expect(canAffordRank(90, 15, 100)).toBe(false);
    expect(canAffordRank(80, 15, 100)).toBe(true);
  });
  it("ideaRunNotice and IDEA_RUN_OFF wording", () => {
    expect(ideaRunNotice(40, 100)).toBe(
      "Suggesting ideas uses AI and live product lookups, which cost real money: usually about 40¢, at most $1.",
    );
    expect(IDEA_RUN_OFF).toBe("Gift ideas aren't available on your account yet.");
  });
});
