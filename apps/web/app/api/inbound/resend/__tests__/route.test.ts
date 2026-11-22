import { beforeEach, describe, expect, it, vi } from "vitest";

const verifySvix = vi.fn();
const handleInbound = vi.fn();
const logEvent = vi.fn();
const upsert = vi.fn();
let afterWork: (() => Promise<void>) | null = null;

vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => (afterWork = fn) }));
vi.mock("@/lib/resend-inbound", () => ({ verifySvix: (...a: unknown[]) => verifySvix(...a) }));
vi.mock("@/lib/log", () => ({
  logEvent: (...a: unknown[]) => logEvent(...a),
  errorFields: (e: unknown) => ({ name: e instanceof Error ? e.name : "unknown" }),
}));
const createExtractor = vi.fn(() => vi.fn());
vi.mock("@/lib/ai/extract", () => ({ createExtractor: () => createExtractor() }));
vi.mock("@/lib/ai/models", () => ({ AI_MODELS: { extraction: "m" } }));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://app.test" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ schema: () => ({ from: () => ({ upsert: (...a: unknown[]) => ({ select: () => upsert(...a) }) }) }) }),
}));
vi.mock("@/modules/concierge", () => ({
  captureStoreFor: vi.fn(),
  createSupabaseInboundStore: vi.fn(),
  createSupabaseNotifyStore: vi.fn(),
  defaultChannels: () => [],
  handleInbound: (...a: unknown[]) => handleInbound(...a),
}));

import { POST } from "../route";

const body = (type = "email.received") => JSON.stringify({ type, data: { email_id: "em_1" } });
const req = (raw = body()) => new Request("https://app.test/api/inbound/resend", { method: "POST", body: raw });

beforeEach(() => {
  vi.clearAllMocks();
  afterWork = null;
  process.env.RESEND_WEBHOOK_SECRET = "whsec_x";
  process.env.INBOUND_NOTES_ADDRESS = "notes@in.test";
  process.env.RESEND_API_KEY = "re_key";
  verifySvix.mockReturnValue(true);
  upsert.mockResolvedValue({ data: [{ provider_email_id: "em_1" }], error: null });
});

describe("POST /api/inbound/resend", () => {
  it("500s and logs when the secret or notes address is missing", async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect((await POST(req())).status).toBe(500);
    expect(logEvent).toHaveBeenCalledWith("inbound.misconfigured", {});
    process.env.RESEND_WEBHOOK_SECRET = "s";
    delete process.env.INBOUND_NOTES_ADDRESS;
    expect((await POST(req())).status).toBe(500);
    expect(verifySvix).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("500s with nothing claimed when building the dependencies throws, so the retry works", async () => {
    createExtractor.mockImplementationOnce(() => {
      throw new Error("no model");
    });
    expect((await POST(req())).status).toBe(500);
    expect(upsert).not.toHaveBeenCalled();
    expect(afterWork).toBeNull();
    expect(logEvent).toHaveBeenCalledWith("inbound.failed", { email_id: "em_1", name: "Error" });
  });

  it("400s a signed body that isn't JSON or has no email id", async () => {
    expect((await POST(req("not json"))).status).toBe(400);
    expect((await POST(req(JSON.stringify({ type: "email.received", data: {} })))).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("401s a bad signature without claiming anything", async () => {
    verifySvix.mockReturnValue(false);
    expect((await POST(req())).status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
    expect(afterWork).toBeNull();
  });

  it("verifies the raw body, then schedules handleInbound with the email id", async () => {
    const raw = body();
    expect((await POST(req(raw))).status).toBe(200);
    expect(verifySvix).toHaveBeenCalledWith(raw, expect.any(Headers), "whsec_x", expect.any(Date));
    expect(upsert).toHaveBeenCalledWith({ provider_email_id: "em_1" }, { onConflict: "provider_email_id", ignoreDuplicates: true });
    expect(afterWork).not.toBeNull();
    await afterWork!();
    expect(handleInbound).toHaveBeenCalledWith(
      "em_1",
      expect.objectContaining({ resend: expect.objectContaining({ apiKey: "re_key" }), notify: expect.any(Object) }),
    );
  });

  it("200s other event types and does nothing", async () => {
    expect((await POST(req(body("email.sent")))).status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
    expect(afterWork).toBeNull();
  });

  it("schedules nothing for an email id already seen", async () => {
    upsert.mockResolvedValue({ data: [], error: null });
    expect((await POST(req())).status).toBe(200);
    expect(afterWork).toBeNull();
  });

  it("500s when the claim fails, so Resend retries", async () => {
    upsert.mockResolvedValue({ data: null, error: new Error("db") });
    expect((await POST(req())).status).toBe(500);
    expect(afterWork).toBeNull();
  });

  it("logs inbound.failed when the after() work throws", async () => {
    handleInbound.mockRejectedValue(new TypeError("boom"));
    await POST(req());
    await afterWork!();
    expect(logEvent).toHaveBeenCalledWith("inbound.failed", { email_id: "em_1", name: "TypeError" });
  });
});
