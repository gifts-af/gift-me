// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  buildAccessRequestEmail,
  requestAccess,
  validateAccessRequest,
} from "@/lib/access-request";
import { EMAIL_FROM, FEEDBACK_EMAIL } from "@/lib/brand";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

// Passes the bot check (ALL-68); tests of the check itself pass their own.
const human = async () => true;

describe("validateAccessRequest", () => {
  it("accepts a name and email, trimmed, with an optional note", () => {
    expect(validateAccessRequest(form({ name: "  Jordan ", email: " jo@example.com ", note: " hi " }))).toEqual({
      ok: true,
      value: { name: "Jordan", email: "jo@example.com", note: "hi" },
      spam: false,
    });
  });

  it("asks for a name and a real email address", () => {
    const result = validateAccessRequest(form({ name: " ", email: "not-an-email" }));
    expect(result).toEqual({
      ok: false,
      errors: { name: "Tell us your name.", email: "Enter an email address like you@example.com." },
    });
  });

  it("flags bots that fill the hidden field", () => {
    const result = validateAccessRequest(form({ name: "Bot", email: "bot@example.com", website: "http://spam" }));
    expect(result).toMatchObject({ ok: true, spam: true });
  });
});

describe("buildAccessRequestEmail", () => {
  it("goes to the owner, from GiftsAF, and replies to the requester", () => {
    const email = buildAccessRequestEmail({ name: "Jordan", email: "jo@example.com", note: "Friend of Jim" });
    expect(email).toEqual({
      to: FEEDBACK_EMAIL,
      replyTo: "jo@example.com",
      subject: "GiftsAF access request: Jordan",
      text: expect.stringContaining("Friend of Jim"),
    });
    expect(email.text).toContain("jo@example.com");
    expect(EMAIL_FROM).toBe("GiftsAF <hello@giftsaf.com>");
  });
});

describe("requestAccess", () => {
  const ok = () => new Response(JSON.stringify({ id: "e1" }), { status: 200 });

  it("sends through Resend and thanks the visitor", async () => {
    const send = vi.fn(async () => ok());
    const result = await requestAccess(form({ name: "Jordan", email: "jo@example.com" }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(result).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toMatchObject({ reply_to: "jo@example.com", to: [FEEDBACK_EMAIL] });
  });

  it("sends nothing for a bad form", async () => {
    const send = vi.fn(async () => ok());
    const result = await requestAccess(form({ name: "", email: "x" }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(result).toMatchObject({ status: "invalid" });
    expect(send).not.toHaveBeenCalled();
  });

  it("pretends to succeed for bots, and sends nothing", async () => {
    const send = vi.fn(async () => ok());
    const result = await requestAccess(form({ name: "Bot", email: "b@example.com", website: "x" }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(result).toEqual({ status: "sent" });
    expect(send).not.toHaveBeenCalled();
  });

  it("says so when sending fails, or the key is missing", async () => {
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    const valid = form({ name: "Jordan", email: "jo@example.com" });
    expect(await requestAccess(valid, { isHuman: human, apiKey: "re_test", fetch: failing })).toEqual({
      status: "error",
      message: "We couldn't send that just now. Please try again in a minute.",
    });
    expect(await requestAccess(valid, { isHuman: human, apiKey: undefined, fetch: failing })).toMatchObject({ status: "error" });
  });

  it("asks the bot check about the form's token (ALL-68)", async () => {
    const isHuman = vi.fn(async () => true);
    await requestAccess(form({ name: "Jordan", email: "jo@example.com", "cf-turnstile-response": "tok-1" }), { isHuman, apiKey: "re_test", fetch: vi.fn(async () => new Response("{}")) });
    expect(isHuman).toHaveBeenCalledWith("tok-1");
  });

  it("sends nothing when the bot check fails, and says so (ALL-68)", async () => {
    const send = vi.fn();
    const result = await requestAccess(form({ name: "Jordan", email: "jo@example.com" }), { isHuman: async () => false, apiKey: "re_test", fetch: send });
    expect(result).toEqual({ status: "error", message: "We couldn't confirm you're a person. Please try again." });
    expect(send).not.toHaveBeenCalled();
  });
});
