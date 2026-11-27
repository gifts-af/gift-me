// The Stripe HTTP client (E4): form-encoded bodies, validated replies, and errors that carry
// Stripe's code only, never its message or an id (E6). Stripe is faked: we don't own it.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { StripeError, formBody, stripeCall } from "../stripe/client";
import type { StripeHttp } from "../stripe/client";

type Seen = { url: string; init: RequestInit };

function http(reply: () => Response | Promise<Response>, seen: Seen[] = []): StripeHttp {
  return {
    key: "sk_test_abc",
    mode: "test",
    timeoutMs: 1000,
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return reply();
    }) as typeof fetch,
  };
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status });

describe("formBody", () => {
  it("encodes nested objects and arrays the way Stripe reads them", () => {
    const body = formBody({ mode: "setup", payment_method_types: ["card"], metadata: { user_id: "u1" }, custom_text: { submit: { message: "a b" } } });
    expect(body.toString()).toBe(
      "mode=setup&payment_method_types%5B0%5D=card&metadata%5Buser_id%5D=u1&custom_text%5Bsubmit%5D%5Bmessage%5D=a+b",
    );
  });

  it("leaves out undefined values", () => {
    expect(formBody({ a: "1", b: undefined }).toString()).toBe("a=1");
  });
});

describe("stripeCall", () => {
  it("sends the key as a bearer token, form-encoded, with an idempotency key when given", async () => {
    const seen: Seen[] = [];
    const out = await stripeCall(http(json(200, { id: "cus_1" }), seen), "POST", "/v1/customers", z.object({ id: z.string() }), {
      op: "create_customer",
      body: { metadata: { user_id: "u1" } },
      idempotencyKey: "customer-u1",
    });
    expect(out).toEqual({ id: "cus_1" });
    expect(seen[0].url).toBe("https://api.stripe.com/v1/customers");
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_abc");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers["Idempotency-Key"]).toBe("customer-u1");
    expect(String(seen[0].init.body)).toBe("metadata%5Buser_id%5D=u1");
  });

  it("puts a GET's query on the URL and sends no body", async () => {
    const seen: Seen[] = [];
    await stripeCall(http(json(200, {}), seen), "GET", "/v1/checkout/sessions/cs_1", z.object({}), {
      op: "read_session",
      query: { "expand[]": "setup_intent" },
    });
    expect(seen[0].url).toBe("https://api.stripe.com/v1/checkout/sessions/cs_1?expand%5B%5D=setup_intent");
    expect(seen[0].init.body).toBeUndefined();
  });

  it("carries Stripe's code but never its message, the path's ids or the key", async () => {
    const reply = json(400, { error: { type: "invalid_request_error", code: "resource_missing", message: "No such customer: 'cus_secret'" } });
    const err = await stripeCall(http(reply), "GET", "/v1/customers/cus_secret", z.object({}), { op: "read_customer" }).catch((e) => e);
    expect(err).toBeInstanceOf(StripeError);
    expect(err.kind).toBe("rejected");
    expect(err.status).toBe(400);
    expect(err.code).toBe("resource_missing");
    expect(err.message).not.toContain("cus_secret");
    expect(err.message).not.toContain("No such");
    expect(err.message).not.toContain("sk_test");
    expect(err.message).toContain("read_customer");
  });

  it("calls a 5xx, a 429 or a network failure unavailable, and a 401 unauthorized", async () => {
    const schema = z.object({});
    await expect(stripeCall(http(json(503, {})), "GET", "/v1/x", schema, { op: "x" })).rejects.toMatchObject({ kind: "unavailable" });
    await expect(stripeCall(http(json(429, {})), "GET", "/v1/x", schema, { op: "x" })).rejects.toMatchObject({ kind: "unavailable" });
    await expect(
      stripeCall(http(() => Promise.reject(new Error("socket sk_test_abc"))), "GET", "/v1/x", schema, { op: "x" }),
    ).rejects.toMatchObject({ kind: "unavailable", status: 0 });
    await expect(stripeCall(http(json(401, {})), "GET", "/v1/x", schema, { op: "x" })).rejects.toMatchObject({ kind: "unauthorized" });
  });

  it("rejects a reply that doesn't match the schema, with no body text", async () => {
    const err = await stripeCall(http(json(200, { id: 5 })), "GET", "/v1/x", z.object({ id: z.string() }), { op: "x" }).catch((e) => e);
    expect(err).toMatchObject({ kind: "rejected", code: "malformed_response" });
  });
});
