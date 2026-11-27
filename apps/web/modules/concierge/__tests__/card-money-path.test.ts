// What the money path tells a card buyer (design/mockups/ALL-98-card-payments.html part 6): the
// round's context turned into each email, against a small fake of the round store. That the real
// store reads these fields is card-placing-db.test.ts; the wording itself is card-emails.test.ts.
import { describe, expect, it, vi } from "vitest";
import type { Channel } from "../notify/channels";
import { sendEmail } from "../rounds/emails";
import type { EngineDeps } from "../rounds/engine";
import { tellFailures, tellOrdered } from "../rounds/money-path";
import type { ClaimedRound, RoundContext, RoundOrder, RoundStore } from "../rounds/store";
import { BASE, captureLog, EMAIL, USER } from "./round-engine-fakes";
import { FakeStore } from "./fake-store";

vi.mock("server-only", () => ({}));
captureLog();

const ZINC = /zinc|balance|wallet/i;
const HOLD = "If you see a pending hold on your card, it will drop off.";
const NEEDED = "Your card changed or couldn't be charged. Nothing was bought.";

function order(over: Partial<RoundOrder> = {}): RoundOrder {
  return {
    id: "o1",
    ideaId: "i1",
    title: "Mouse pad",
    shipCity: "Austin, TX",
    status: "placed",
    sent: true,
    holdReason: null,
    failureType: null,
    resolved: false,
    failedAt: null,
    failedAfterClose: false,
    maxPriceCents: 2485,
    feeCents: 305,
    totalCents: 2259,
    refundCents: null,
    store: "amazon",
    deliveredAt: null,
    fundingMode: "connect",
    finalChargeCents: 2564,
    ...over,
  };
}

function setup(orders: RoundOrder[], o: { hasCard?: boolean } = {}) {
  const sends = new Set<string>();
  const ctx = {
    userId: USER,
    personId: "p1",
    personName: "Jimmy",
    occasionKind: "birthday",
    occasionDate: "2030-03-12",
    shipByDeadline: "2030-03-03",
    hasAddress: true,
    hasSharedAddress: true,
    openQuestions: 0,
    ideas: [],
    orders,
    hasCard: o.hasCard ?? false,
    personRemoved: false,
    closedEarly: false,
    dateChanged: false,
  } as unknown as RoundContext;
  const store = {
    roundContext: async () => ctx,
    sentSteps: async () => new Set(sends),
    recordSend: async (_r: string, _u: string, step: string) => (sends.has(step) ? false : (sends.add(step), true)),
    forgetSend: async (_r: string, step: string) => void sends.delete(step),
    setting: async () => 100,
    claimFailureNotices: async () => orders.filter((x) => x.status === "failed" && !x.failedAfterClose).map((x) => x.id),
    releaseFailureNotices: async () => {},
  } as unknown as RoundStore;
  const notifyStore = new FakeStore();
  notifyStore.recipients.set(USER, { email: EMAIL, timezone: null });
  const emails: { subject: string; text: string; html?: string }[] = [];
  const channel: Channel = { name: "email", send: async (e) => (emails.push(e), { ok: true as const, id: `m${emails.length}` }) };
  const now = new Date("2030-02-20T12:00:00Z");
  const deps = { store, notify: { store: notifyStore, channels: [channel], baseUrl: BASE, now }, now, generateIdeas: vi.fn(), zinc: null } as unknown as EngineDeps;
  const round = { id: "r1", userId: USER, shipByDeadline: "2030-03-03", lockedUntil: now } as ClaimedRound;
  return { deps, round, emails, said: () => emails.map((e) => `${e.subject}\n${e.text}`).join("\n---\n") };
}

describe("ordered by card", () => {
  it("AC-20: the gift, the GiftsAF fee and the charge, from the settled order", async () => {
    const t = setup([order()]);
    await tellOrdered("r1", t.deps);
    expect(t.emails).toHaveLength(1);
    expect(t.said()).toContain("$22.59 · price, shipping and tax");
    expect(t.said()).toContain("$3.05");
    expect(t.said()).toContain("Charged to your card: $25.64");
    expect(t.said()).not.toMatch(ZINC);
  });

  it("a wallet order's ordered email has no charge rows", async () => {
    const t = setup([order({ fundingMode: "zinc_wallet", finalChargeCents: null, feeCents: 100 })]);
    await tellOrdered("r1", t.deps);
    expect(t.said()).not.toContain("Charged to your card");
  });

  it("AC-11: a shared address shows the city only, never the street", async () => {
    const t = setup([order()]);
    await tellOrdered("r1", t.deps);
    expect(t.said()).toContain("on its way to Austin, TX.");
    expect(t.emails[0].html).not.toMatch(/\d+ \w+ (St|Ave|Rd)\b/);
  });
});

describe("failed after the round closed", () => {
  it("AC-8: a card failure says nothing was charged and a pending hold drops off", async () => {
    const t = setup([order({ status: "failed", failureType: "failed", failedAfterClose: true })]);
    await tellOrdered("r1", t.deps);
    expect(t.said()).toContain(HOLD);
    expect(t.said()).not.toMatch(ZINC);
  });

  it("AC-6: card_needed in its own words, never the store's", async () => {
    const t = setup([order({ status: "failed", failureType: "card_needed", failedAfterClose: true })]);
    await tellOrdered("r1", t.deps);
    expect(t.said()).toContain(NEEDED);
    expect(t.said()).not.toContain("store couldn't place");
  });
});

describe("failed while the round is open", () => {
  it("AC-6: card_needed with no card saved: add a card and tap Buy again", async () => {
    const t = setup([order({ status: "failed", failureType: "card_needed", sent: false })], { hasCard: false });
    expect(await tellFailures(t.round, t.deps)).toBe("sent");
    expect(t.emails[0].subject).toBe("Sorry, we couldn't buy Jimmy's gift yet");
    expect(t.said()).toContain(NEEDED);
    expect(t.said()).toContain("Add a card and tap Buy again.");
    expect(t.said()).not.toContain("store couldn't place");
  });

  it("AC-6: card_needed with a card saved: tap Buy again", async () => {
    const t = setup([order({ status: "failed", failureType: "card_needed", sent: false })], { hasCard: true });
    await tellFailures(t.round, t.deps);
    expect(t.said()).toContain("Tap Buy again.");
    expect(t.said()).not.toContain("Add a card");
  });

  it("AC-6: in the summary, each card_needed row says what to do", async () => {
    const t = setup(
      [order({ status: "failed", failureType: "card_needed" }), order({ id: "o2", ideaId: "i2", title: "Mug", status: "failed", failureType: "out_of_stock" })],
      { hasCard: false },
    );
    await tellFailures(t.round, t.deps);
    expect(t.said()).toContain(`${NEEDED} Add a card and tap Buy again.`);
    expect(t.said()).not.toContain("store couldn't place");
    expect(t.said()).not.toMatch(ZINC);
  });

  it("AC-8: an ordinary card failure says a pending hold drops off", async () => {
    const t = setup([order({ status: "failed", failureType: "failed" })]);
    await tellFailures(t.round, t.deps);
    expect(t.said()).toContain(HOLD);
    expect(t.said()).not.toMatch(ZINC);
  });

  it("AC-9: a store cancel says the whole charge is refunded to the card, fee included", async () => {
    const t = setup([order({ status: "failed", failureType: "store_cancelled", refundCents: 2259 })]);
    await tellFailures(t.round, t.deps);
    expect(t.said()).toContain("the whole charge, $25.64, is refunded to your card, fee included");
    expect(t.said()).not.toMatch(ZINC);
  });

  it("a wallet failure is told as before", async () => {
    const t = setup([order({ status: "failed", failureType: "failed", fundingMode: "zinc_wallet", finalChargeCents: null })]);
    await tellFailures(t.round, t.deps);
    expect(t.said()).toContain("the store couldn't place the order for the Mouse pad, and you haven't been charged for it.");
    expect(t.said()).not.toContain(HOLD);
  });
});

describe("held card orders", () => {
  it.each([
    ["hold:1:notice", "address"],
    ["hold:1:notice", "setup"],
    ["hold_trouble", "retry"],
  ] as const)("AC-20: %s (%s) names the GiftsAF fee, never Zinc", async (step, reason) => {
    const t = setup([order({ status: "held", holdReason: reason, sent: false, finalChargeCents: null, totalCents: null })]);
    const round = { ...t.round, attentionReason: reason, shipByDeadline: "2030-03-03" } as ClaimedRound;
    const ctx = await t.deps.store.roundContext("r1");
    await sendEmail(step, round, ctx, t.deps, {});
    expect(t.said()).toContain("its price plus the GiftsAF fee");
    expect(t.said()).not.toMatch(ZINC);
  });

  it("a wallet hold still names Zinc's fee", async () => {
    const t = setup([order({ status: "held", holdReason: "address", fundingMode: "zinc_wallet", finalChargeCents: null })]);
    const round = { ...t.round, attentionReason: "address", shipByDeadline: "2030-03-03" } as ClaimedRound;
    await sendEmail("hold:1:notice", round, await t.deps.store.roundContext("r1"), t.deps, {});
    expect(t.said()).toContain("its price plus Zinc's $1 fee");
  });
});
