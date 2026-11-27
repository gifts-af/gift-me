import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import type { ZincHttp } from "./client";

export type ZincDeps = {
  db: SupabaseClient<Database>;
  http: ZincHttp;
  env: "test" | "live";
  webhookBaseUrl: string;
  now: Date;
};

/** What reads and writes on our own database need: the service-role client and the clock. */
export type DbDeps = Pick<ZincDeps, "db" | "now">;

export type PlaceHeld = (userId: string) => Promise<void>;

/** After a person's address is saved: places that person's rounds held for an address. */
export type PlaceAddressHeld = (userId: string, personId: string) => Promise<void>;

export type ZincAddress = {
  firstName: string;
  lastName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type ZincOrderInput = {
  /** Our orders.id. Sent as metadata.order_id so we can find the order again. */
  reference: string;
  /** At most 36 characters. */
  idempotencyKey: string;
  productUrl: string;
  maxPriceCents: number;
  shipTo: ZincAddress;
  phone: string;
  giftMessage: string | null;
  /**
   * A card order's payment (Zinc Connect): null on a wallet order. Without it Zinc pays from the
   * account's wallet, so sendConnectOrder refuses a card order that lacks it.
   */
  payment: ZincPayment | null;
};

/** What Zinc charges a card order to: the card the order was approved with, our Stripe customer, and its saved margin. */
export type ZincPayment = { mode: "connect"; paymentMethod: string; customer: string; marginCents: number };

export type FoundOrder = {
  providerOrderId: string;
  status: "pending" | "placed" | "failed";
  errorType?: string;
  /** From job_result.price_components on a placed order, when Zinc gives whole cents. */
  price?: { subtotalCents?: number; shippingCents?: number; taxCents?: number; totalCents?: number };
  /** A card order's whole charge (connect.final_charge), when Zinc gives whole cents (A7). */
  finalChargeCents?: number;
};

/** A placed order's prices as settle_order takes them (p_price). */
export type PlacedPrice = {
  provider_order_id: string;
  subtotal_cents?: number;
  shipping_cents?: number;
  tax_cents?: number;
  total_cents?: number;
  final_charge_cents?: number;
};
