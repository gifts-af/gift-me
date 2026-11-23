// Pure order-tracking rules: which packages we keep, when a gift is expected,
// when that is late, and which link a person can follow. No I/O (E3).
import { addDays, compareDates, maxDate, parseDate } from "./dates";

export type TrackedPackage = {
  carrier: string;
  trackingNumber: string;
  status: string | null;
  estimatedDeliveryDate: string | null;
  trackingUrl: string | null;
};

type PackageRow = {
  carrier: string;
  tracking_number: string;
  status: string | null;
  estimated_delivery_date: string | null;
  tracking_url: string | null;
};

// Carrier tracking pages (public, fixed by the carriers, not tunable values).
// A Map, because the carrier name comes from the vendor.
const CARRIER_TRACKING = new Map<string, string>([
  ["ups", "https://www.ups.com/track?tracknum="],
  ["fedex", "https://www.fedex.com/fedextrack/?trknbr="],
  ["usps", "https://tools.usps.com/go/TrackConfirmAction?tLabels="],
  ["dhl", "https://www.dhl.com/us-en/home/tracking.html?tracking-id="],
]);

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function validDate(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  try {
    parseDate(s);
    return s;
  } catch {
    return null;
  }
}

/**
 * Whitelist what we keep from a vendor response, so proof-of-delivery links and
 * checkpoint locations never reach our database (T42). Reads Zinc's entries
 * (`zinc_tracking_url`) and our stored rows (`tracking_url`).
 */
export function packagesFromZinc(raw: unknown): TrackedPackage[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackedPackage[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const carrier = text(e.carrier);
    const trackingNumber = text(e.tracking_number);
    if (!carrier || !trackingNumber) continue;
    out.push({
      carrier,
      trackingNumber,
      status: text(e.status),
      estimatedDeliveryDate: validDate(e.estimated_delivery_date),
      trackingUrl: text(e.zinc_tracking_url) ?? text(e.tracking_url),
    });
  }
  return out;
}

/** The shape stored in `orders.packages`. */
export function packagesToRows(p: TrackedPackage[]): PackageRow[] {
  return p.map((x) => ({
    carrier: x.carrier,
    tracking_number: x.trackingNumber,
    status: x.status,
    estimated_delivery_date: x.estimatedDeliveryDate,
    tracking_url: x.trackingUrl,
  }));
}

/** The last day any package is expected, since the gift is whole only then. */
export function latestEstimate(p: TrackedPackage[]): string | null {
  let latest: string | null = null;
  for (const x of p) {
    if (x.estimatedDeliveryDate) {
      latest = latest ? maxDate(latest, x.estimatedDeliveryDate) : x.estimatedDeliveryDate;
    }
  }
  return latest;
}

export function expectedArrival(o: {
  estDeliveryDate: string | null;
  placedAt: string | null;
  handlingDaysMax: number | null;
  deliveryDaysMax: number | null;
}): { date: string; source: "carrier" | "store_range" } | null {
  if (o.estDeliveryDate) return { date: o.estDeliveryDate, source: "carrier" };
  if (!o.placedAt || o.handlingDaysMax === null || o.deliveryDaysMax === null) return null;
  const placed = new Date(o.placedAt);
  if (Number.isNaN(placed.getTime())) return null;
  const placedDay = placed.toISOString().slice(0, 10);
  return {
    date: addDays(placedDay, o.handlingDaysMax + o.deliveryDaysMax),
    source: "store_range",
  };
}

/** Late means strictly after the occasion day. */
export function isLate(expected: string, occasionDate: string): boolean {
  return compareDates(expected, occasionDate) > 0;
}

export function trackingNews(o: {
  expected: string | null;
  occasionDate: string;
  today: string;
  sentLate: boolean;
  sentOnTime: boolean;
}): "late" | "on_time" | null {
  if (compareDates(o.today, o.occasionDate) > 0) return null;
  if (!o.expected) return null;
  const late = isLate(o.expected, o.occasionDate);
  if (late && !o.sentLate) return "late";
  if (!late && o.sentLate && !o.sentOnTime) return "on_time";
  return null;
}

/** Zinc's own https link first, then the carrier's page; Amazon has no public one. */
export function trackingLink(p: TrackedPackage): string | null {
  if (p.trackingUrl) {
    try {
      if (new URL(p.trackingUrl).protocol === "https:") return p.trackingUrl;
    } catch {
      // not a URL, fall through to the carrier page
    }
  }
  const base = CARRIER_TRACKING.get(p.carrier.trim().toLowerCase());
  return base ? base + encodeURIComponent(p.trackingNumber) : null;
}
