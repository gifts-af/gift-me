import { describe, expect, it, vi } from "vitest";
import { lookUpAmazonProduct, type AmazonLookupDeps } from "../amazon-lookup";

const USER = "11111111-1111-4111-8111-111111111111";
const ASIN = "B0G5Z36T3N";
const PRODUCT = {
  productId: ASIN,
  name: "SOULWIT Headband Protector",
  priceCents: 1195,
  imageUrl: "https://m.media-amazon.com/images/I/51jwXyqEB3L.jpg",
};
const ON = { enabled: true, timeoutMs: 10000, lookupCents: 1 };

function deps(over: Partial<AmazonLookupDeps> = {}) {
  let t = 1000;
  const log = vi.fn();
  const d: AmazonLookupDeps = {
    takeQuota: vi.fn(async () => true),
    details: vi.fn(async () => PRODUCT),
    log,
    now: () => (t += 25),
    ...over,
  };
  return d as AmazonLookupDeps & { log: typeof log };
}

function onlyEvent(d: { log: ReturnType<typeof vi.fn> }) {
  expect(d.log).toHaveBeenCalledTimes(1);
  const [event, fields] = d.log.mock.calls[0];
  expect(event).toBe("list.amazon_lookup");
  return fields as Record<string, unknown>;
}

describe("lookUpAmazonProduct (ALL-141)", () => {
  it("takes one lookup from the day's quota, asks Zinc and gives back the product", async () => {
    const d = deps();
    expect(await lookUpAmazonProduct({ asin: ASIN, userId: USER }, ON, d)).toEqual({ ok: true, product: PRODUCT });
    expect(d.takeQuota).toHaveBeenCalledTimes(1);
    expect(d.details).toHaveBeenCalledWith(ASIN, expect.any(AbortSignal));
    expect(onlyEvent(d)).toEqual({ user_id: USER, outcome: "ok", cents: 1, ms: 25 });
  });

  it("logs ids only: never the ASIN or the product's name", async () => {
    const d = deps();
    await lookUpAmazonProduct({ asin: ASIN, userId: USER }, ON, d);
    const text = JSON.stringify(d.log.mock.calls);
    expect(text).not.toContain(ASIN);
    expect(text).not.toContain("SOULWIT");
  });

  it("does nothing when switched off", async () => {
    const d = deps();
    expect(await lookUpAmazonProduct({ asin: ASIN, userId: USER }, { ...ON, enabled: false }, d)).toEqual({
      ok: false,
      reason: "off",
    });
    expect(d.takeQuota).not.toHaveBeenCalled();
    expect(d.details).not.toHaveBeenCalled();
    expect(onlyEvent(d)).toMatchObject({ outcome: "off", cents: 0 });
  });

  it("does nothing when Zinc isn't set up here", async () => {
    const d = deps({ details: null });
    expect(await lookUpAmazonProduct({ asin: ASIN, userId: USER }, ON, d)).toEqual({ ok: false, reason: "not_configured" });
    expect(d.takeQuota).not.toHaveBeenCalled();
    expect(onlyEvent(d)).toMatchObject({ outcome: "not_configured", cents: 0 });
  });

  it("refuses an ASIN that isn't ten capital letters and digits", async () => {
    for (const asin of ["b0g5z36t3n", "B0G5Z36T3", "B0G5Z36T3N1", "../B0G5Z3", 42]) {
      const d = deps();
      expect(await lookUpAmazonProduct({ asin: asin as string, userId: USER }, ON, d)).toEqual({ ok: false, reason: "bad_asin" });
      expect(d.takeQuota).not.toHaveBeenCalled();
      expect(d.details).not.toHaveBeenCalled();
      expect(onlyEvent(d)).toMatchObject({ outcome: "bad_asin", cents: 0 });
    }
  });

  it("stops at the day's limit without asking Zinc", async () => {
    const d = deps({ takeQuota: vi.fn(async () => false) });
    expect(await lookUpAmazonProduct({ asin: ASIN, userId: USER }, ON, d)).toEqual({ ok: false, reason: "over_limit" });
    expect(d.details).not.toHaveBeenCalled();
    expect(onlyEvent(d)).toMatchObject({ outcome: "over_limit", cents: 0 });
  });

  it("is unavailable when the quota can't be read, without asking Zinc", async () => {
    const d = deps({
      takeQuota: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    expect(await lookUpAmazonProduct({ asin: ASIN, userId: USER }, ON, d)).toEqual({ ok: false, reason: "unavailable" });
    expect(d.details).not.toHaveBeenCalled();
    expect(onlyEvent(d)).toMatchObject({ outcome: "unavailable", cents: 0 });
  });

  it("is not_found when Zinc has no finished product, and counts the lookup's cost", async () => {
    const d = deps({ details: vi.fn(async () => null) });
    expect(await lookUpAmazonProduct({ asin: ASIN, userId: USER }, ON, d)).toEqual({ ok: false, reason: "not_found" });
    expect(onlyEvent(d)).toMatchObject({ outcome: "not_found", cents: 1 });
  });

  it("is unavailable when Zinc fails, and counts the lookup's cost", async () => {
    const err = Object.assign(new Error("Zinc GET /products/B0G5Z36T3N failed (503)"), { name: "ZincError", kind: "unavailable", status: 503 });
    const d = deps({
      details: vi.fn(async () => {
        throw err;
      }),
    });
    expect(await lookUpAmazonProduct({ asin: ASIN, userId: USER }, ON, d)).toEqual({ ok: false, reason: "unavailable" });
    const fields = onlyEvent(d);
    expect(fields).toMatchObject({ outcome: "unavailable", cents: 1, kind: "unavailable", status: 503 });
    expect(JSON.stringify(fields)).not.toContain(ASIN);
  });

  it("gives up after the timeout setting", async () => {
    const d = deps({
      details: vi.fn(
        (_asin: string, signal?: AbortSignal) =>
          new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      ),
    });
    expect(await lookUpAmazonProduct({ asin: ASIN, userId: USER }, { ...ON, timeoutMs: 20 }, d)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
