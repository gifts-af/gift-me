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

export type PlaceHeld = (userId: string) => Promise<void>;

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
};

export type FoundOrder = {
  providerOrderId: string;
  status: "pending" | "placed" | "failed";
  errorType?: string;
  /** From job_result.price_components on a placed order, when Zinc gives whole cents. */
  price?: { subtotalCents?: number; shippingCents?: number; taxCents?: number; totalCents?: number };
};
