// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { EMAIL_FROM } from "@/lib/brand";
import { EMAIL_LOGO_URL } from "@/lib/email-layout";

const INBOX = "allensforever711+feedback@gmail.com";
import { sendFeedback } from "@/lib/feedback";
import { sendEmail } from "@/lib/resend";

// ALL-53: the "sad story" box emails the owner through the shared Resend
// sender (lib/resend.ts). The real sender runs; the spy just shows it's used.
vi.mock("@/lib/resend", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/resend")>();
  return { ...real, sendEmail: vi.fn(real.sendEmail) };
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

// Passes the bot check (ALL-68); tests of the check itself pass their own.
const human = async () => true;

const ok = () => new Response(JSON.stringify({ id: "e1" }), { status: 200 });
const sentBody = (send: ReturnType<typeof vi.fn>) => {
  const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) };
};

describe("sendFeedback", () => {
  it("emails the owner the message, with reply-to when they leave an email", async () => {
    const send = vi.fn(async () => ok());
    const result = await sendFeedback(form({ message: "The share link opened a blank page.", email: "jo@example.com" }), {
      isHuman: human,
      apiKey: "re_test",
      fetch: send,
    });
    expect(result).toEqual({ status: "sent" });
    expect(sendEmail).toHaveBeenCalledWith(
      {
        to: INBOX,
        subject: "GiftsAF feedback",
        html: expect.stringContaining(EMAIL_LOGO_URL),
        text: expect.stringContaining("The share link opened a blank page."),
        replyTo: "jo@example.com",
      },
      { isHuman: human, apiKey: "re_test", fetch: send },
    );
    const { url, init, body } = sentBody(send);
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(body).toMatchObject({
      from: EMAIL_FROM,
      to: [INBOX],
      reply_to: "jo@example.com",
      subject: "GiftsAF feedback",
    });
    expect(body.text).toContain("The share link opened a blank page.");
  });

  it("sends without reply-to when no email is given", async () => {
    const send = vi.fn(async () => ok());
    await sendFeedback(form({ message: "Love it" }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(sentBody(send).body).not.toHaveProperty("reply_to");
  });

  it("asks for a message and sends nothing when it's empty", async () => {
    const send = vi.fn(async () => ok());
    const result = await sendFeedback(form({ message: "   " }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(result).toEqual({ status: "invalid", errors: { message: "Tell us what happened." } });
    expect(send).not.toHaveBeenCalled();
  });

  it("checks an email if one is given", async () => {
    const send = vi.fn(async () => ok());
    const result = await sendFeedback(form({ message: "Hi", email: "nope" }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(result).toEqual({ status: "invalid", errors: { email: "Enter an email address like you@example.com, or leave it blank." } });
    expect(send).not.toHaveBeenCalled();
  });

  it("pretends to succeed for bots, and sends nothing", async () => {
    const send = vi.fn(async () => ok());
    const result = await sendFeedback(form({ message: "Buy now", website: "x" }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(result).toEqual({ status: "sent" });
    expect(send).not.toHaveBeenCalled();
  });

  it("says so when sending fails, or the key is missing", async () => {
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    const valid = form({ message: "Hi" });
    expect(await sendFeedback(valid, { isHuman: human, apiKey: "re_test", fetch: failing })).toEqual({
      status: "error",
      message: "We couldn't send that just now. Please try again in a minute.",
    });
    expect(await sendFeedback(valid, { isHuman: human, apiKey: undefined, fetch: failing })).toMatchObject({ status: "error" });
    const throwing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await sendFeedback(valid, { isHuman: human, apiKey: "re_test", fetch: throwing })).toMatchObject({ status: "error" });
  });

  it("asks the bot check about the form's token (ALL-68)", async () => {
    const isHuman = vi.fn(async () => true);
    await sendFeedback(form({ message: "Hi", "cf-turnstile-response": "tok-1" }), { isHuman, apiKey: "re_test", fetch: vi.fn(async () => new Response("{}")) });
    expect(isHuman).toHaveBeenCalledWith("tok-1");
  });

  it("sends nothing when the bot check fails, and says so (ALL-68)", async () => {
    const send = vi.fn();
    const result = await sendFeedback(form({ message: "Hi" }), { isHuman: async () => false, apiKey: "re_test", fetch: send });
    expect(result).toEqual({ status: "error", message: "We couldn't confirm you're a person. Please try again." });
    expect(send).not.toHaveBeenCalled();
  });
});
