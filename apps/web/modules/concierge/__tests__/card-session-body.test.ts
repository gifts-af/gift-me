// What we ask Stripe's card page for (AC-21 and the owner's on-brand ask): cards only, setup
// mode, our consent text, and GiftsAF's branding, with nothing about the buyer but the customer id.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { STRIPE_API_VERSION, formBody, stripeCall } from "../stripe/client";
import { FakeStripe } from "./fake-stripe";
import { CARD_CONSENT_TEXT, checkoutSessionBody } from "../stripe/card";

const SITE = "https://preview.example.vercel.app";

describe("checkoutSessionBody", () => {
  const body = formBody(checkoutSessionBody("cus_1", SITE));

  it("AC-21: a card-only setup session with our consent text and no customer_update", () => {
    expect(body.get("mode")).toBe("setup");
    expect(body.get("customer")).toBe("cus_1");
    expect(body.getAll("payment_method_types[0]")).toEqual(["card"]);
    expect([...body.keys()].filter((k) => k.startsWith("payment_method_types"))).toEqual(["payment_method_types[0]"]);
    expect([...body.keys()].some((k) => k.startsWith("customer_update"))).toBe(false);
    expect(body.get("custom_text[submit][message]")).toBe(CARD_CONSENT_TEXT);
    expect(body.get("success_url")).toBe(`${SITE}/rounds/card/return?session_id={CHECKOUT_SESSION_ID}`);
    expect(body.get("cancel_url")).toBe(body.get("success_url"));
  });

  it("brands Stripe's page as GiftsAF, with the gift-tag art the site already serves", () => {
    expect(body.get("branding_settings[display_name]")).toBe("GiftsAF");
    expect(body.get("branding_settings[icon][type]")).toBe("url");
    expect(body.get("branding_settings[icon][url]")).toBe("https://giftsaf.com/apple-icon");
    expect(body.get("branding_settings[logo][type]")).toBe("url");
    expect(body.get("branding_settings[logo][url]")).toBe("https://giftsaf.com/email-logo.png");
    expect(body.get("branding_settings[button_color]")).toBe("#0f766e");
    expect(body.get("branding_settings[background_color]")).toBe("#ffffff");
    expect(body.get("branding_settings[border_style]")).toBe("rounded");
    expect(body.get("branding_settings[font_family]")).toBe("default");
  });

  it("uses the approved consent wording, within Stripe's 1,200 characters", () => {
    expect(CARD_CONSENT_TEXT).toBe(
      "GiftsAF keeps this card to buy gifts you approve. We charge it only when you tap Buy now or Buy again, or on an auto-buy date we emailed you about. " +
        "Each charge is for one gift: its price, shipping and tax, plus the GiftsAF fee. It's never more than the “Most you’ll pay” we showed you. " +
        "Saving a card doesn’t buy anything. You can remove it anytime in Settings. Charges show as GIFTSAF.",
    );
    expect(CARD_CONSENT_TEXT.length).toBeLessThanOrEqual(1200);
  });
});

// The fake refuses what real Stripe would, so a parameter it doesn't know, or a call that doesn't
// pin the API version branding_settings needs, fails here instead of on the card page.
describe("the fake Stripe holds our calls to Stripe's contract", () => {
  const sessionSchema = z.object({ id: z.string(), url: z.string() });

  it("accepts our Checkout Session as stripeCall sends it", async () => {
    const fake = new FakeStripe();
    await expect(
      stripeCall(fake.http(), "POST", "/v1/checkout/sessions", sessionSchema, { op: "create_session", body: checkoutSessionBody("cus_1", SITE) }),
    ).resolves.toMatchObject({ id: expect.stringMatching(/^cs_/) });
  });

  it("refuses a top-level parameter Stripe doesn't have", async () => {
    const fake = new FakeStripe();
    const err = await stripeCall(fake.http(), "POST", "/v1/checkout/sessions", sessionSchema, {
      op: "create_session",
      body: { ...checkoutSessionBody("cus_1", SITE), brand_colours: { button: "#000" } },
    }).catch((e) => e);
    expect(err).toMatchObject({ kind: "rejected", status: 400, code: "parameter_unknown" });
  });

  it("refuses a call with no Stripe-Version, or one older than branding_settings", async () => {
    const fake = new FakeStripe();
    const send = (headers: Record<string, string>) =>
      fake.fetch("https://api.stripe.com/v1/customers", { method: "POST", headers: { Authorization: "Bearer sk_test_fake", ...headers }, body: "" });
    expect((await send({})).status).toBe(400);
    expect((await send({ "Stripe-Version": "2025-08-27.basil" })).status).toBe(400);
    expect((await send({ "Stripe-Version": STRIPE_API_VERSION })).status).toBe(200);
  });
});
