import { z } from "zod";
import type { EmailRow } from "@/lib/email-layout";
import type { AdminDb } from "../ideas/store";

// What `concierge.cost_per_gift` returns, already in our own names. Parsed here because the
// database is a boundary (E4); the dates strictly, so costLines can't fail on one and take the
// whole email with it.
const cents = z.number().nonnegative();
const count = z.number().int().nonnegative();
const costSchema = z.object({
  // When counting starts: the later of the window's start and cost_tracking_since.
  since: z.iso.datetime(),
  windowDays: count,
  gifts: count,
  aiCents: cents,
  lookupCents: cents,
  aiRecords: count,
  aiEstimated: count,
  bills: z.array(z.object({ month: z.iso.date(), vendors: z.array(z.string()) })),
  billCents: cents,
  billGifts: count,
  orderFeeCents: cents,
  // The QA account's costs, not in any number above.
  excludedCents: cents,
});

export type CostPerGift = z.output<typeof costSchema>;

/** The costs as of `now`, or null when tracking is off. Throws when they can't be read within timeoutMs. */
export async function readCostPerGift(db: AdminDb, now: Date, timeoutMs: number): Promise<CostPerGift | null> {
  const { data, error } = await db
    .schema("concierge")
    .rpc("cost_per_gift", { p_now: now.toISOString() })
    .abortSignal(AbortSignal.timeout(timeoutMs));
  if (error) throw error;
  return costSchema.nullable().parse(data);
}

// Cents are added and divided unrounded, and rounded only here, so the parts shown can differ
// from their sum by a cent.
const dollars = (cents: number) => `$${(Math.round(cents) / 100).toFixed(2)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// UTC, like the window and the email's other dates.
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const month = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

/** The weekly email's cost rows. With no gifts there are totals only, so nothing divides by zero. */
export function costLines(c: CostPerGift): EmailRow[] {
  const perGift = (total: number) => (c.gifts > 0 ? total / c.gifts : null);
  const ai = perGift(c.aiCents);
  const lookups = perGift(c.lookupCents);
  const running = c.bills.length > 0 && c.billGifts > 0 ? c.billCents / c.billGifts : null;
  const title = (name: string, each: number | null) => (each === null ? name : `${name}: ${dollars(each)}`);

  const months = c.bills.map((b) => `${month(b.month)}: ${b.vendors.join(", ")}`).join(". ");
  const over = c.billGifts > 0 ? ` over ${plural(c.billGifts, "gift", "gifts")}` : ", no gifts in those months";
  const bills = c.bills.length > 0 ? `${dollars(c.billCents)} of bills${over}. ${months}` : "No bills entered yet";

  let fixed: EmailRow = { title: "Fixed part of the fee", detail: "Can't be worked out yet" };
  if (ai !== null && lookups !== null) {
    const base = c.orderFeeCents + ai + lookups;
    const includes = `Includes Zinc's ${dollars(c.orderFeeCents)} order fee. The card fee is added per gift.`;
    fixed =
      running === null
        ? { title: `Fixed part of the fee: ${dollars(base)}`, detail: `Without running the service. ${includes}` }
        : { title: `Fixed part of the fee: ${dollars(base)}, or ${dollars(base + running)} with running the service`, detail: includes };
  }

  return [
    {
      title: "Cost per completed gift",
      detail: `Counted since ${day(c.since)}. ${c.gifts > 0 ? plural(c.gifts, "completed gift", "completed gifts") : "No completed gifts yet"}`,
    },
    {
      title: title("AI suggestions", ai),
      detail: `${dollars(c.aiCents)} in total, ${c.aiEstimated} of ${plural(c.aiRecords, "AI record", "AI records")} estimated`,
    },
    { title: title("Product lookups", lookups), detail: `${dollars(c.lookupCents)} in total` },
    { title: title("Running the service", running), detail: bills },
    fixed,
    { title: `QA account: ${dollars(c.excludedCents)}`, detail: "Not counted above" },
  ];
}
