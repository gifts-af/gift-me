// What both fake Stripes (the unit fake and the browser tests' stand-in) hold our calls to, so a
// request real Stripe would refuse fails our tests instead of production: every call names an API
// version at least as new as the one that knows `branding_settings`, and a Checkout Session asks
// only for parameters Stripe's API has. Error bodies follow Stripe's shape: { error: { type, code } }.

/** The first API version with Checkout's `branding_settings` (Stripe's changelog). */
const BRANDING_SINCE = "2025-09-30";

// Stripe's top-level Checkout Session create parameters (API reference, 2025-09-30.clover).
const CHECKOUT_SESSION_PARAMS = new Set([
  "adaptive_pricing",
  "after_expiration",
  "allow_promotion_codes",
  "automatic_tax",
  "billing_address_collection",
  "branding_settings",
  "cancel_url",
  "client_reference_id",
  "consent_collection",
  "currency",
  "custom_fields",
  "custom_text",
  "customer",
  "customer_creation",
  "customer_email",
  "customer_update",
  "discounts",
  "excluded_payment_method_types",
  "expand",
  "expires_at",
  "invoice_creation",
  "line_items",
  "locale",
  "metadata",
  "mode",
  "name_collection",
  "optional_items",
  "origin_context",
  "payment_intent_data",
  "payment_method_collection",
  "payment_method_configuration",
  "payment_method_data",
  "payment_method_options",
  "payment_method_types",
  "permissions",
  "phone_number_collection",
  "redirect_on_completion",
  "return_url",
  "saved_payment_method_options",
  "setup_intent_data",
  "shipping_address_collection",
  "shipping_options",
  "submit_type",
  "subscription_data",
  "success_url",
  "tax_id_collection",
  "ui_mode",
  "wallet_options",
]);

export type StripeRefusal = { status: number; body: { error: { type: string; code: string; param?: string } } };

/** Why the fake refuses a call: no pinned version, or one older than branding_settings. Null when fine. */
export function versionRefusal(header: string | null | undefined): StripeRefusal | null {
  const m = /^(\d{4}-\d{2}-\d{2})\.[a-z]+$/.exec(header ?? "");
  if (m && m[1] >= BRANDING_SINCE) return null;
  return { status: 400, body: { error: { type: "invalid_request_error", code: "api_version_unpinned" } } };
}

/** Why the fake refuses a Checkout Session body: a top-level parameter Stripe doesn't have. Null when fine. */
export function checkoutParamRefusal(body: URLSearchParams): StripeRefusal | null {
  for (const key of body.keys()) {
    const top = key.split("[")[0];
    if (!CHECKOUT_SESSION_PARAMS.has(top)) {
      return { status: 400, body: { error: { type: "invalid_request_error", code: "parameter_unknown", param: top } } };
    }
  }
  return null;
}
