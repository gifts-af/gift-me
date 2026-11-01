// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { EMAIL_FROM } from "@/lib/brand";
import { sendEmail } from "@/lib/resend";

const email = { to: "jo@example.com", subject: "Hi", text: "Hello" };
const ok = () => new Response(JSON.stringify({ id: "e1" }), { status: 200 });

describe("sendEmail", () => {
  it("posts to Resend with the key, the shared sender and the recipient", async () => {
    const send = vi.fn(async () => ok());
    const result = await sendEmail(email, { apiKey: "re_test", fetch: send });
    expect(result).toEqual({ ok: true, id: "e1" });
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ from: EMAIL_FROM, to: ["jo@example.com"], subject: "Hi", text: "Hello" });
    expect(body).not.toHaveProperty("reply_to");
  });

  it("includes reply_to and html only when given", async () => {
    const send = vi.fn(async () => ok());
    await sendEmail({ ...email, replyTo: "a@example.com", html: "<p>Hello</p>" }, { apiKey: "re_test", fetch: send });
    const [, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ reply_to: "a@example.com", html: "<p>Hello</p>" });
  });

  it("returns ok: false with the status on a non-2xx response", async () => {
    const send = vi.fn(async () => new Response("bad", { status: 422 }));
    const result = await sendEmail(email, { apiKey: "re_test", fetch: send });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("422") });
  });

  it("returns ok: false when fetch throws", async () => {
    const send = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await sendEmail(email, { apiKey: "re_test", fetch: send });
    expect(result).toMatchObject({ ok: false });
  });

  it("returns ok: false without calling fetch when there is no key", async () => {
    const send = vi.fn(async () => ok());
    const result = await sendEmail(email, { apiKey: undefined, fetch: send });
    expect(result).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });
});
