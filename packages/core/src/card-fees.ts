// What a card buyer is charged (planning 59, 61). Zinc Connect adds our
// margin and its own order fee to the goods, then grosses the sum up so the
// card fee (a percentage plus a fixed amount) is covered by the charge itself.
// Every input is a setting saved on the order at approval (T23); the math is
// whole cents and basis points, so nothing here rounds through floats.

export type FeeInputs = {
  /** Our part of the fee: AI suggestions and running the service. */
  marginCents: number;
  /** Zinc's fee per order. */
  zincFeeCents: number;
  /** The card fee's percentage part, in basis points (290 = 2.9%). */
  cardFeeBps: number;
  /** The card fee's fixed part. */
  cardFeeFixedCents: number;
};

const BPS = 10000;

function checkCents(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${what} must be whole cents, 0 or more; got ${value}`);
  }
}

function fixedSum(f: FeeInputs): number {
  checkCents(f.marginCents, "Margin");
  checkCents(f.zincFeeCents, "Zinc fee");
  checkCents(f.cardFeeFixedCents, "Card fee fixed part");
  if (!Number.isInteger(f.cardFeeBps) || f.cardFeeBps < 0 || f.cardFeeBps >= BPS) {
    throw new RangeError(`Card fee rate must be whole basis points below ${BPS}; got ${f.cardFeeBps}`);
  }
  return f.marginCents + f.zincFeeCents + f.cardFeeFixedCents;
}

/**
 * The whole charge for goods costing `goodsCents`: rounded up, so the charge
 * we show is never below what the card is charged.
 */
export function chargeCents(goodsCents: number, f: FeeInputs): number {
  checkCents(goodsCents, "Goods");
  const sum = fixedSum(f);
  return Math.ceil(((goodsCents + sum) * BPS) / (BPS - f.cardFeeBps));
}

/**
 * The most the goods may cost so the whole charge stays within
 * `maxChargeCents`. Throws when the maximum can't even cover the fees.
 */
export function goodsCapCents(maxChargeCents: number, f: FeeInputs): number {
  checkCents(maxChargeCents, "Maximum charge");
  const sum = fixedSum(f);
  const goods = Math.floor((maxChargeCents * (BPS - f.cardFeeBps)) / BPS) - sum;
  if (goods <= 0) {
    throw new RangeError(`A maximum of ${maxChargeCents} doesn't cover the fees`);
  }
  // goods + sum <= max * (1 - rate), so the grossed-up charge, rounded up, is at most max.
  return goods;
}

/** Each part of the GiftsAF fee for goods costing `goodsCents`, for the (i) breakdown. */
export function feeParts(
  goodsCents: number,
  f: FeeInputs,
): { marginCents: number; zincFeeCents: number; cardFeeCents: number; totalFeeCents: number } {
  const total = chargeCents(goodsCents, f) - goodsCents;
  return {
    marginCents: f.marginCents,
    zincFeeCents: f.zincFeeCents,
    cardFeeCents: total - f.marginCents - f.zincFeeCents,
    totalFeeCents: total,
  };
}
