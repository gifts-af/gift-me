// Who pays for a buyer's gifts and with which fees, for every reader that shows or judges a
// total. A wallet buyer's total is the idea's saved est_total_cents (goods plus Zinc's wallet
// fee). A card buyer's is the whole charge: the goods plus the GiftsAF fee at today's
// settings (planning 59, 61), which counts toward the person's budget (planning 66). Nothing
// card-shaped is saved on the idea, so a fee change or a switch of payer never goes stale.
import { chargeCents, goodsCapCents, type FeeInputs } from "@gifts-af/core";
import type { DbDeps } from "../zinc/types";
import { capsFor, type ApproveError } from "./approve";
import { concierge, fail, setting, type Account, type RoundRow } from "./store";

export type Payer = { mode: "zinc_wallet"; feeCents: number } | { mode: "connect"; fees: FeeInputs };

/**
 * The buyer's way of paying, from accounts.funding_mode (no account row pays by wallet, as the
 * SQL does), with today's fee settings. The margin is its two parts (card_margin_cents). A
 * missing setting throws (T23).
 */
export async function readPayer(d: DbDeps, userId: string): Promise<Payer> {
  const { data, error } = await concierge(d).from("accounts").select("funding_mode").eq("user_id", userId).maybeSingle();
  if (error) fail("Reading how the buyer pays failed", error);
  if (data?.funding_mode !== "connect") return { mode: "zinc_wallet", feeCents: await setting(d, "zinc_order_fee_cents") };
  const [ai, running, zincFeeCents, cardFeeBps, cardFeeFixedCents] = await Promise.all([
    setting(d, "fee_part_ai_cents"),
    setting(d, "fee_part_running_cents"),
    setting(d, "zinc_fee_cents"),
    setting(d, "card_fee_bps"),
    setting(d, "card_fee_fixed_cents"),
  ]);
  return { mode: "connect", fees: { marginCents: ai + running, zincFeeCents, cardFeeBps, cardFeeFixedCents } };
}

/** What an idea costs this buyer: the wallet total, or the whole card charge. */
export function ideaTotalCents(i: { goods_cents: number | null; est_total_cents: number }, p: Payer): number {
  if (p.mode === "zinc_wallet") return i.est_total_cents;
  if (i.goods_cents === null) throw new Error("The idea has no goods total saved.");
  return chargeCents(i.goods_cents, p.fees);
}

/** The fee inputs a card order was approved with, as approve_round saved them. */
export function savedFees(o: { margin_cents: number | null; zinc_fee_cents: number | null; card_fee_bps: number | null; card_fee_fixed_cents: number | null }): FeeInputs {
  if (o.margin_cents === null || o.zinc_fee_cents === null || o.card_fee_bps === null || o.card_fee_fixed_cents === null) {
    throw new Error("A card order has no fee inputs saved.");
  }
  return { marginCents: o.margin_cents, zincFeeCents: o.zinc_fee_cents, cardFeeBps: o.card_fee_bps, cardFeeFixedCents: o.card_fee_fixed_cents };
}

/**
 * Each pick's goods cap (max_price) and the most the buyer can be charged. `totals` are
 * ideaTotalCents for this payer. A card buyer runs the same budget math on whole charges with
 * no separate fee, then each charge becomes a goods cap; `maxCharges` is what approve_round
 * saves for each (card_charge_cents of the cap), so the figure shown is the one saved.
 */
export function capsForPayer(
  round: Pick<RoundRow, "budget_cents">,
  totals: number[],
  account: Pick<Account, "over_budget_pct">,
  confirmed: boolean,
  p: Payer,
  marginPct: number,
  committedCents: number,
): { caps: number[]; maxCharges: number[] | null; neverMoreThanCents: number } | ApproveError {
  if (p.mode === "zinc_wallet") {
    const fit = capsFor(round, totals, account, confirmed, { feeCents: p.feeCents, marginPct }, committedCents);
    return typeof fit === "string" ? fit : { ...fit, maxCharges: null };
  }
  const fit = capsFor(round, totals, account, confirmed, { feeCents: 0, marginPct }, committedCents);
  if (typeof fit === "string") return fit;
  try {
    const caps = fit.caps.map((charge) => goodsCapCents(charge, p.fees));
    const maxCharges = caps.map((cap) => chargeCents(cap, p.fees));
    return { caps, maxCharges, neverMoreThanCents: maxCharges.reduce((a, b) => a + b, 0) };
  } catch (e) {
    // A charge too small to cover the fees: there's no room for this gift.
    if (e instanceof RangeError) return "over_budget";
    throw e;
  }
}
