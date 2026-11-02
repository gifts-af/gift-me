import { describe, expect, it, vi } from "vitest";
import { defaultChannels } from "../notify/channels";

const email = { to: "a@b.test", subject: "Hi", html: "<p>x</p>", text: "x" };

describe("defaultChannels email outbox", () => {
  it("logs instead of sending with EMAIL_OUTBOX=log outside production", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const [channel] = defaultChannels({ EMAIL_OUTBOX: "log", VERCEL_ENV: "preview" });
    const res = await channel.send(email);
    expect(res.ok && res.id.startsWith("outbox-")).toBe(true);
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain("email_outbox");
    expect(line).not.toContain("a@b.test");
    log.mockRestore();
  });

  it("uses Resend (fails without a key) in production even if EMAIL_OUTBOX=log", async () => {
    const [channel] = defaultChannels({ EMAIL_OUTBOX: "log", VERCEL_ENV: "production" });
    expect(await channel.send(email)).toEqual({ ok: false, error: "RESEND_API_KEY is not set" });
  });

  it("uses Resend when EMAIL_OUTBOX is unset", async () => {
    const [channel] = defaultChannels({});
    expect(await channel.send(email)).toEqual({ ok: false, error: "RESEND_API_KEY is not set" });
  });
});
