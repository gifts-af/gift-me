// What the Monday email's cost rows say, and what reading the costs accepts. The real
// cost_per_gift is in cost_tracking.test.sql and health-db.test.ts (E5).
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { describe, expect, it, vi } from "vitest";
import { costLines, readCostPerGift } from "../health/costs";
import { costs, MONDAY } from "./health-fixtures";

vi.mock("server-only", () => ({}));

const said = (over: Parameters<typeof costs>[0] = {}) => costLines(costs(over)).map((r) => [r.title, r.detail]);

describe("costLines", () => {
  it("AC-9: gifts and bills, with the fixed part with and without running the service", () => {
    expect(said()).toEqual([
      ["Cost per completed gift", "Counted since Nov 25, 2026. 12 completed gifts"],
      ["AI suggestions: $0.31", "$3.72 in total, 2 of 41 AI records estimated"],
      ["Product lookups: $0.21", "$2.52 in total"],
      ["Running the service: $0.83", "$5.00 of bills over 6 gifts. Dec: Resend, domain. Jan: Resend, domain"],
      ["Fixed part of the fee: $1.52, or $2.35 with running the service", "Includes Zinc's $1.00 order fee. The card fee is added per gift."],
      ["QA account: $0.42", "Not counted above"],
    ]);
  });

  it("one of each is singular", () => {
    const rows = said({ gifts: 1, billGifts: 1, aiRecords: 1, aiEstimated: 1 });
    expect(rows[0][1]).toBe("Counted since Nov 25, 2026. 1 completed gift");
    expect(rows[1][1]).toBe("$3.72 in total, 1 of 1 AI record estimated");
    expect(rows[3][1]).toContain("$5.00 of bills over 1 gift. ");
  });

  it("the counting date is in UTC, like the email's other dates", () => {
    expect(said({ since: "2026-11-25T00:30:00.000Z" })[0][1]).toContain("since Nov 25, 2026.");
    expect(said({ since: "2026-11-25T23:30:00.000Z" })[0][1]).toContain("since Nov 25, 2026.");
  });

  it("rounds only what's shown: the fixed part is worked out from the unrounded cents", () => {
    // 10.4 + 10.4 + 10 cents: the parts show as $0.10 each, the sum as $0.31.
    const rows = said({ gifts: 10, aiCents: 104, lookupCents: 104, orderFeeCents: 10 });
    expect(rows[1][0]).toBe("AI suggestions: $0.10");
    expect(rows[2][0]).toBe("Product lookups: $0.10");
    expect(rows[4][0]).toContain("Fixed part of the fee: $0.31,");
    // Half a cent rounds up, whatever its floating-point value.
    expect(said({ excludedCents: 100.5 })[5][0]).toBe("QA account: $1.01");
  });

  it("AC-10: no gifts shows totals only, with no division by zero", () => {
    const rows = said({ gifts: 0, billGifts: 0 });
    expect(rows).toEqual([
      ["Cost per completed gift", "Counted since Nov 25, 2026. No completed gifts yet"],
      ["AI suggestions", "$3.72 in total, 2 of 41 AI records estimated"],
      ["Product lookups", "$2.52 in total"],
      ["Running the service", "$5.00 of bills, no gifts in those months. Dec: Resend, domain. Jan: Resend, domain"],
      ["Fixed part of the fee", "Can't be worked out yet"],
      ["QA account: $0.42", "Not counted above"],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/NaN|Infinity/);
  });

  it("no gifts and no bills", () => {
    const rows = said({ gifts: 0, billGifts: 0, bills: [], billCents: 0, aiCents: 0, lookupCents: 0, aiRecords: 0, aiEstimated: 0, excludedCents: 0 });
    expect(rows[1]).toEqual(["AI suggestions", "$0.00 in total, 0 of 0 AI records estimated"]);
    expect(rows[3]).toEqual(["Running the service", "No full month of bills yet"]);
    expect(JSON.stringify(rows)).not.toMatch(/NaN|Infinity/);
  });

  it("no bills: says so, and only the fixed part without running the service", () => {
    const rows = said({ bills: [], billCents: 0, billGifts: 0 });
    expect(rows[3]).toEqual(["Running the service", "No full month of bills yet"]);
    expect(rows[4]).toEqual(["Fixed part of the fee: $1.52", "Without running the service. Includes Zinc's $1.00 order fee. The card fee is added per gift."]);
  });

  it("bills but no gifts in those months: the total, and the same fixed part", () => {
    const rows = said({ billGifts: 0 });
    expect(rows[3]).toEqual(["Running the service", "$5.00 of bills, no gifts in those months. Dec: Resend, domain. Jan: Resend, domain"]);
    expect(rows[4][0]).toBe("Fixed part of the fee: $1.52");
  });

  it("AC-14: card orders' own Zinc and card fees show once each, and the wallet fee setting isn't added for them", () => {
    const rows = said({ cardGifts: 2, zincFeeCents: 200, cardFeeOrders: 2, cardFeeCents: 150 });
    expect(rows[5]).toEqual([
      "Card orders settled: 2",
      "Zinc's fees $2.00 in total, $1.00 an order. Card fees $1.50 in total, $0.75 an order. As recorded per order, not in the fixed part above.",
    ]);
    // The fixed part is the same as without card gifts: it isn't $1.00 more for each of them.
    expect(rows[4]).toEqual(said()[4]);
    const all = rows.flat().join(" ");
    expect(all.split("$2.00")).toHaveLength(2);
    expect(rows[6]).toEqual(["QA account: $0.42", "Not counted above"]);
  });

  it("the card fee is averaged over the orders that have one, not every order settled", () => {
    const rows = said({ cardGifts: 3, zincFeeCents: 300, cardFeeOrders: 2, cardFeeCents: 210 });
    expect(rows[5]).toEqual([
      "Card orders settled: 3",
      "Zinc's fees $3.00 in total, $1.00 an order. Card fees $2.10 in total, $1.05 an order over the 2 with a known total. As recorded per order, not in the fixed part above.",
    ]);
  });

  it("no card fee known yet: totals only, nothing divides by zero", () => {
    const rows = said({ cardGifts: 1, zincFeeCents: 100, cardFeeOrders: 0, cardFeeCents: 0 });
    expect(rows[5][1]).toBe("Zinc's fees $1.00 in total, $1.00 an order. Card fees $0.00 in total, none known yet. As recorded per order, not in the fixed part above.");
  });

  it("no card orders: no card row, so a wallet-only report is unchanged", () => {
    expect(said().map((r) => r[0])).not.toContain(expect.stringContaining("Card orders"));
    expect(said()).toHaveLength(6);
  });

  it("AC-8: the QA account's line shows at $0.00 too", () => {
    expect(said({ excludedCents: 0 })[5]).toEqual(["QA account: $0.00", "Not counted above"]);
  });
});

describe("readCostPerGift", () => {
  const client = (fetch: typeof globalThis.fetch) =>
    createClient<Database>("http://local.test", "key", { auth: { persistSession: false }, global: { fetch } });
  const answering = (body: unknown, status = 200) =>
    client(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  it("asks for the costs as of now and returns them", async () => {
    const asked: { url: string; body: unknown }[] = [];
    const db = client(async (url, init) => {
      asked.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify(costs()), { status: 200, headers: { "content-type": "application/json" } });
    });
    expect(await readCostPerGift(db, MONDAY, 1000)).toEqual(costs());
    expect(asked).toEqual([{ url: "http://local.test/rest/v1/rpc/cost_per_gift", body: { p_now: MONDAY.toISOString() } }]);
  });

  it("null when tracking is off", async () => {
    expect(await readCostPerGift(answering(null), MONDAY, 1000)).toBeNull();
  });

  it.each([
    ["a missing number", { ...costs(), gifts: undefined }],
    ["a number as text", { ...costs(), aiCents: "372" }],
    ["a date that isn't one", { ...costs(), since: "soon" }],
    ["card fees missing", { ...costs(), cardFeeCents: undefined }],
    ["the card fee's order count missing", { ...costs(), cardFeeOrders: undefined }],
    ["a month that isn't one", { ...costs(), bills: [{ month: "2026-13-01", vendors: ["Resend"] }] }],
  ])("refuses %s (E4)", async (_what, body) => {
    await expect(readCostPerGift(answering(body), MONDAY, 1000)).rejects.toMatchObject({ name: "ZodError" });
  });

  it("a query error throws with its code", async () => {
    const db = answering({ message: "missing setting", code: "P0001", details: null, hint: null }, 400);
    await expect(readCostPerGift(db, MONDAY, 1000)).rejects.toMatchObject({ code: "P0001" });
  });

  it("gives up on a hung read", async () => {
    const db = client(
      (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))),
    );
    await expect(readCostPerGift(db, MONDAY, 20)).rejects.toBeTruthy();
  });
});
