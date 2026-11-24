import { describe, expect, it } from "vitest";
import {
  calendarDay,
  expectedArrival,
  isLate,
  latestEstimate,
  packagesFromZinc,
  packagesToRows,
  trackingLink,
  trackingNews,
  type TrackedPackage,
} from "./tracking";

const pkg = (over: Partial<TrackedPackage> = {}): TrackedPackage => ({
  carrier: "ups",
  trackingNumber: "1Z 999",
  status: null,
  estimatedDeliveryDate: null,
  trackingUrl: null,
  ...over,
});

describe("calendarDay", () => {
  it("keeps a real date, or the date part of a timestamp", () => {
    expect(calendarDay("2030-12-05")).toBe("2030-12-05");
    expect(calendarDay("2030-12-05T00:00:00Z")).toBe("2030-12-05");
    expect(calendarDay("2032-02-29")).toBe("2032-02-29");
  });

  it("is null for an impossible date, a bad shape or not a string", () => {
    for (const v of ["2030-02-30", "2030-02-30T00:00:00Z", "2030-13-01", "2030-12-5", "soon", "", null, undefined, 20301205]) {
      expect(calendarDay(v)).toBeNull();
    }
  });
});

describe("packagesFromZinc", () => {
  it("keeps a package whose estimate is an impossible date, without the estimate", () => {
    expect(packagesFromZinc([{ carrier: "UPS", tracking_number: "1Z", estimated_delivery_date: "2030-02-30" }])).toEqual([
      { carrier: "UPS", trackingNumber: "1Z", status: null, estimatedDeliveryDate: null, trackingUrl: null },
    ]);
  });


  it("keeps only whitelisted fields", () => {
    const out = packagesFromZinc([
      {
        carrier: "ups",
        tracking_number: "1Z1",
        status: "in_transit",
        estimated_delivery_date: "2026-12-20",
        zinc_tracking_url: "https://z.example/t/1",
        delivery_proof_url: "https://secret.example/proof",
        checkpoints: [{ city: "Reno" }],
        city: "Reno",
      },
    ]);
    expect(out).toEqual([
      {
        carrier: "ups",
        trackingNumber: "1Z1",
        status: "in_transit",
        estimatedDeliveryDate: "2026-12-20",
        trackingUrl: "https://z.example/t/1",
      },
    ]);
    expect(Object.keys(out[0]!).sort()).toEqual(
      ["carrier", "estimatedDeliveryDate", "status", "trackingNumber", "trackingUrl"],
    );
  });

  it("accepts our stored rows and drops entries missing carrier or number", () => {
    const out = packagesFromZinc([
      { carrier: "fedex", tracking_number: "9", tracking_url: "https://f.example/9" },
      { carrier: "ups" },
      { tracking_number: "5" },
      "junk",
      null,
    ]);
    expect(out).toEqual([
      pkg({ carrier: "fedex", trackingNumber: "9", trackingUrl: "https://f.example/9" }),
    ]);
  });

  it("returns nothing for a non-array", () => {
    expect(packagesFromZinc(undefined)).toEqual([]);
    expect(packagesFromZinc({})).toEqual([]);
  });

  it("drops a malformed estimate date", () => {
    const out = packagesFromZinc([
      { carrier: "ups", tracking_number: "1", estimated_delivery_date: "soon" },
    ]);
    expect(out[0]!.estimatedDeliveryDate).toBeNull();
  });
});

describe("packagesToRows", () => {
  it("round-trips through packagesFromZinc", () => {
    const ps = [
      pkg({ status: "delivered", estimatedDeliveryDate: "2026-12-01", trackingUrl: "https://x.example/1" }),
      pkg({ carrier: "usps", trackingNumber: "94" }),
    ];
    const rows = packagesToRows(ps);
    expect(rows[0]).toEqual({
      carrier: "ups",
      tracking_number: "1Z 999",
      status: "delivered",
      estimated_delivery_date: "2026-12-01",
      tracking_url: "https://x.example/1",
    });
    expect(packagesFromZinc(rows)).toEqual(ps);
  });
});

describe("latestEstimate", () => {
  it("picks the latest date", () => {
    expect(
      latestEstimate([
        pkg({ estimatedDeliveryDate: "2026-12-10" }),
        pkg({ estimatedDeliveryDate: "2026-12-18" }),
        pkg({ estimatedDeliveryDate: null }),
      ]),
    ).toBe("2026-12-18");
  });
  it("is null with no estimates", () => {
    expect(latestEstimate([pkg()])).toBeNull();
    expect(latestEstimate([])).toBeNull();
  });
});

describe("expectedArrival", () => {
  it("prefers the carrier estimate", () => {
    expect(
      expectedArrival({
        estDeliveryDate: "2026-12-20",
        placedAt: "2026-12-01T10:00:00Z",
        handlingDaysMax: 2,
        deliveryDaysMax: 5,
      }),
    ).toEqual({ date: "2026-12-20", source: "carrier" });
  });
  it("without an estimate adds handling and delivery max to placed_at", () => {
    expect(
      expectedArrival({
        estDeliveryDate: null,
        placedAt: "2026-12-01T23:30:00Z",
        handlingDaysMax: 2,
        deliveryDaysMax: 5,
      }),
    ).toEqual({ date: "2026-12-08", source: "store_range" });
  });
  it("uses the UTC day of an offset timestamp", () => {
    expect(
      expectedArrival({ estDeliveryDate: null, placedAt: "2026-11-30T23:30:00-05:00", handlingDaysMax: 0, deliveryDaysMax: 0 }),
    ).toEqual({ date: "2026-12-01", source: "store_range" });
  });
  it("ignores an unparseable placed_at", () => {
    expect(
      expectedArrival({ estDeliveryDate: null, placedAt: "nope", handlingDaysMax: 1, deliveryDaysMax: 1 }),
    ).toBeNull();
  });
  it("with nothing is null", () => {
    expect(
      expectedArrival({ estDeliveryDate: null, placedAt: null, handlingDaysMax: 2, deliveryDaysMax: 5 }),
    ).toBeNull();
    expect(
      expectedArrival({ estDeliveryDate: null, placedAt: "2026-12-01T00:00:00Z", handlingDaysMax: null, deliveryDaysMax: 5 }),
    ).toBeNull();
    expect(
      expectedArrival({ estDeliveryDate: null, placedAt: "2026-12-01T00:00:00Z", handlingDaysMax: 2, deliveryDaysMax: null }),
    ).toBeNull();
  });
});

describe("isLate", () => {
  it("expected on the occasion day is not late", () => {
    expect(isLate("2026-12-25", "2026-12-25")).toBe(false);
  });
  it("one day after is late", () => {
    expect(isLate("2026-12-26", "2026-12-25")).toBe(true);
  });
});

describe("trackingNews", () => {
  const base = { expected: "2026-12-26", occasionDate: "2026-12-25", today: "2026-12-20", sentLate: false, sentOnTime: false };
  it("says late when the gift is late", () => {
    expect(trackingNews(base)).toBe("late");
  });
  it("an occasion today still gets news", () => {
    expect(trackingNews({ ...base, today: "2026-12-25" })).toBe("late");
  });
  it("no news after the occasion", () => {
    expect(trackingNews({ ...base, today: "2026-12-26" })).toBeNull();
  });
  it("on_time only after late was sent", () => {
    const fine = { ...base, expected: "2026-12-24" };
    expect(trackingNews(fine)).toBeNull();
    expect(trackingNews({ ...fine, sentLate: true })).toBe("on_time");
    expect(trackingNews({ ...fine, sentLate: true, sentOnTime: true })).toBeNull();
  });
  it("does not repeat late, and says nothing without an expected date", () => {
    expect(trackingNews({ ...base, sentLate: true })).toBeNull();
    expect(trackingNews({ ...base, expected: null })).toBeNull();
  });
});

describe("trackingLink", () => {
  it("trackingLink encodes the number", () => {
    expect(trackingLink(pkg({ carrier: "ups", trackingNumber: "1Z 99&9" }))).toBe(
      "https://www.ups.com/track?tracknum=1Z%2099%269",
    );
    expect(trackingLink(pkg({ carrier: "fedex", trackingNumber: "7" }))).toBe(
      "https://www.fedex.com/fedextrack/?trknbr=7",
    );
    expect(trackingLink(pkg({ carrier: "usps", trackingNumber: "9" }))).toBe(
      "https://tools.usps.com/go/TrackConfirmAction?tLabels=9",
    );
    expect(trackingLink(pkg({ carrier: "dhl", trackingNumber: "8" }))).toBe(
      "https://www.dhl.com/us-en/home/tracking.html?tracking-id=8",
    );
  });
  it("amazon has no link", () => {
    expect(trackingLink(pkg({ carrier: "amazon" }))).toBeNull();
    expect(trackingLink(pkg({ carrier: "mystery" }))).toBeNull();
  });
  it("ignores inherited property names as carriers", () => {
    for (const c of ["constructor", "toString", "__proto__"]) {
      expect(trackingLink(pkg({ carrier: c }))).toBeNull();
    }
  });
  it("normalizes the carrier name", () => {
    expect(trackingLink(pkg({ carrier: " UPS " }))).toBe("https://www.ups.com/track?tracknum=1Z%20999");
  });
  it("zinc's https link wins", () => {
    expect(trackingLink(pkg({ trackingUrl: "https://z.example/t" }))).toBe("https://z.example/t");
  });
  it("a non-https zinc link is ignored", () => {
    expect(trackingLink(pkg({ trackingUrl: "http://z.example/t" }))).toBe(
      "https://www.ups.com/track?tracknum=1Z%20999",
    );
    expect(trackingLink(pkg({ trackingUrl: "javascript:alert(1)", carrier: "amazon" }))).toBeNull();
  });
});
