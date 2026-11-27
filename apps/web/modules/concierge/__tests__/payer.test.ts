// Who pays and with which fees: the whole charge a card buyer sees and is judged on, and the
// caps that keep it there (AC-4, AC-5, AC-15). Pure math; the database side is in
// approval-db.test.ts and replace.test.ts.
import { describe, expect, it } from "vitest";
import { chargeCents, goodsCapCents, type FeeInputs } from "@gifts-af/core";
import { capsForPayer, ideaTotalCents, type Payer } from "../purchase/payer";
import { recheckedCaps } from "../purchase/place";
import type { OrderRow, RoundRow } from "../purchase/store";

const F: FeeInputs = { marginCents: 100, zincFeeCents: 100, cardFeeBps: 290, cardFeeFixedCents: 30 };
const card: Payer = { mode: "connect", fees: F };
const wallet: Payer = { mode: "zinc_wallet", feeCents: 100 };

describe("ideaTotalCents", () => {
  it("is the saved wallet total for a wallet buyer", () => {
    expect(ideaTotalCents({ goods_cents: 2259, est_total_cents: 2359 }, wallet)).toBe(2359);
  });
  it("is the whole charge, fee included, for a card buyer", () => {
    expect(ideaTotalCents({ goods_cents: 2259, est_total_cents: 2359 }, card)).toBe(2564);
  });
  it("refuses a card total for an idea with no goods saved", () => {
    expect(() => ideaTotalCents({ goods_cents: null, est_total_cents: 2359 }, card)).toThrow();
  });
});

describe("capsForPayer", () => {
  const account = { over_budget_pct: 20 };

  it("keeps every price up to the cap within the most shown (goods $22.59, 10% margin)", () => {
    const fit = capsForPayer({ budget_cents: null }, [2564], account, false, card, 10, 0);
    if (typeof fit === "string") throw new Error(fit);
    expect(fit.maxCharges).toEqual([chargeCents(fit.caps[0], F)]);
    expect(fit.neverMoreThanCents).toBe(fit.maxCharges![0]);
    expect(fit.neverMoreThanCents).toBeLessThanOrEqual(Math.floor((2564 * 110) / 100));
    for (let g = 1; g <= fit.caps[0]; g++) expect(chargeCents(g, F)).toBeLessThanOrEqual(fit.neverMoreThanCents);
  });

  it("counts the GiftsAF fee against the budget: $22.59 is over $25 by card, within it by wallet", () => {
    expect(capsForPayer({ budget_cents: 2500 }, [2564], account, false, card, 10, 0)).toBe("needs_confirmation");
    expect(capsForPayer({ budget_cents: 2500 }, [2359], account, false, wallet, 10, 0)).toMatchObject({ caps: [2400], maxCharges: null });
  });

  it("keeps two picks together within the ceiling", () => {
    const totals = [chargeCents(2259, F), chargeCents(2000, F)];
    const fit = capsForPayer({ budget_cents: 6000 }, totals, account, false, card, 10, 0);
    if (typeof fit === "string") throw new Error(fit);
    expect(fit.maxCharges!.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6000);
    expect(fit.neverMoreThanCents).toBeLessThanOrEqual(6000);
  });

  it("counts what the round's other orders already hold", () => {
    expect(capsForPayer({ budget_cents: 3000 }, [2564], { over_budget_pct: 0 }, false, card, 10, 1000)).toBe("over_budget");
  });

  it("is today's capsFor for a wallet buyer", () => {
    expect(capsForPayer({ budget_cents: 10000 }, [4200], account, false, wallet, 10, 0)).toEqual({
      caps: [Math.floor((4200 * 110) / 100) - 100],
      maxCharges: null,
      neverMoreThanCents: Math.floor((4200 * 110) / 100),
    });
  });

  it("is over budget when the ceiling can't even cover the fees", () => {
    expect(capsForPayer({ budget_cents: null }, [200], account, false, card, 0, 0)).toBe("over_budget");
  });
});

describe("recheckedCaps for a card order", () => {
  const round: RoundRow = {
    id: "r1",
    user_id: "u1",
    person_id: "p1",
    occasion_id: "o1",
    occasion_date: "2030-12-25",
    ship_by_deadline: "2030-12-18",
    budget_cents: 3000,
    status: "needs_attention",
    attention_reason: "retry",
    locked_until: null,
    closed_at: null,
  };
  const order = (o: Partial<OrderRow>): OrderRow => ({
    id: "o1",
    idea_id: "i1",
    status: "held",
    hold_reason: "retry",
    max_price_cents: 2400,
    fee_cents: 0,
    total_cents: null,
    idempotency_key: "k",
    gift_message: null,
    ship_to: "recipient",
    address_source: "own",
    address_owner_id: null,
    created_at: "2030-01-01T00:00:00Z",
    funding_mode: "connect",
    margin_cents: F.marginCents,
    zinc_fee_cents: F.zincFeeCents,
    card_fee_bps: F.cardFeeBps,
    card_fee_fixed_cents: F.cardFeeFixedCents,
    ...o,
  });

  it("uses the fees the order was approved with, not today's, and never goes above the saved cap", () => {
    const savedCap = goodsCapCents(3000, F);
    const held = order({ max_price_cents: savedCap, fee_cents: chargeCents(savedCap, F) - savedCap });
    const ideas = new Map([["i1", { goods_cents: 2259, est_total_cents: 2359 }]]);
    const [cap] = recheckedCaps(round, [held], [held], ideas, 20, 10);
    const charge = chargeCents(2259, F);
    // Within the $30 budget: the ceiling is the budget, capped at the charge plus 10%.
    expect(cap).toBe(Math.min(savedCap, goodsCapCents(Math.min(3000, Math.floor((charge * 110) / 100)), F)));
    expect(chargeCents(cap, F)).toBeLessThanOrEqual(3000);

    // Saved with lower fees than today's: the recheck still uses the saved ones.
    const cheap = { ...F, marginCents: 0 };
    const old = order({ margin_cents: 0, max_price_cents: goodsCapCents(3000, cheap) });
    const [oldCap] = recheckedCaps(round, [old], [old], ideas, 20, 10);
    expect(oldCap).toBe(Math.min(old.max_price_cents, goodsCapCents(Math.min(3000, Math.floor((chargeCents(2259, cheap) * 110) / 100)), cheap)));
    expect(oldCap).not.toBe(cap);
  });

  it("keeps the saved cap when the idea has no goods saved", () => {
    const held = order({ max_price_cents: 2000 });
    expect(recheckedCaps(round, [held], [held], new Map([["i1", { goods_cents: null, est_total_cents: 2359 }]]), 20, 10)).toEqual([2000]);
  });

  it("is unchanged for a wallet order", () => {
    const held = order({ funding_mode: "zinc_wallet", fee_cents: 100, max_price_cents: 2900, margin_cents: null, zinc_fee_cents: null, card_fee_bps: null, card_fee_fixed_cents: null });
    const ideas = new Map([["i1", { goods_cents: 2259, est_total_cents: 2359 }]]);
    expect(recheckedCaps(round, [held], [held], ideas, 20, 10)).toEqual([Math.min(2900, Math.floor((2359 * 110) / 100) - 100)]);
  });
});
