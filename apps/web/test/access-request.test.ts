// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  type AccessRequest,
  buildAccessRequestEmail,
  buildRequestConfirmation,
  requestAccess,
  validateAccessRequest,
} from "@/lib/access-request";
import { EMAIL_FROM, inboxFor } from "@/lib/brand";
import { EMAIL_LOGO_URL } from "@/lib/email-layout";

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
      value: { name: "Jordan", email: "jo@example.com", note: "hi", kind: "access" },
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

  it("reads the waitlist kind, and counts anything else as access (ALL-71)", () => {
    const base = { name: "Jordan", email: "jo@example.com" };
    expect(validateAccessRequest(form({ ...base, kind: "waitlist" }))).toMatchObject({ value: { kind: "waitlist" } });
    expect(validateAccessRequest(form({ ...base, kind: "admin" }))).toMatchObject({ value: { kind: "access" } });
    expect(validateAccessRequest(form(base))).toMatchObject({ value: { kind: "access" } });
  });

  it("flags bots that fill the hidden field", () => {
    const result = validateAccessRequest(form({ name: "Bot", email: "bot@example.com", website: "http://spam" }));
    expect(result).toMatchObject({ ok: true, spam: true });
  });
});

const jordan: AccessRequest = { name: "Jordan", email: "jo@example.com", note: "Friend of Jim", kind: "access" };

describe("inboxFor (ALL-71)", () => {
  it("tags the team inbox so Gmail filters can sort it", () => {
    expect(inboxFor("access")).toBe("allensforever711+access@gmail.com");
    expect(inboxFor("waitlist")).toBe("allensforever711+waitlist@gmail.com");
    expect(inboxFor("feedback")).toBe("allensforever711+feedback@gmail.com");
  });
});

describe("buildAccessRequestEmail", () => {
  it("access requests go to +access, from GiftsAF, and reply to the requester", () => {
    const email = buildAccessRequestEmail(jordan);
    expect(email).toMatchObject({
      to: "allensforever711+access@gmail.com",
      replyTo: "jo@example.com",
      subject: "GiftsAF access request: Jordan",
    });
    expect(email.text).toContain("Friend of Jim");
    expect(email.text).toContain("jo@example.com");
    expect(email.text).toContain("Test users");
    expect(EMAIL_FROM).toBe("GiftsAF <hello@giftsaf.com>");
  });

  it("waitlist goes to +waitlist and asks to email them at launch", () => {
    const email = buildAccessRequestEmail({ ...jordan, kind: "waitlist" });
    expect(email).toMatchObject({ to: "allensforever711+waitlist@gmail.com", subject: "GiftsAF waitlist: Jordan" });
    expect(email.text).toContain("wants the concierge");
    expect(email.text).not.toContain("Test users");
  });

  it("owner emails are branded", () => {
    expect(buildAccessRequestEmail(jordan).html).toContain(EMAIL_LOGO_URL);
    expect(buildAccessRequestEmail({ ...jordan, kind: "waitlist" }).html).toContain(EMAIL_LOGO_URL);
  });

  it("a name can't break the email", () => {
    const email = buildAccessRequestEmail({ ...jordan, name: "<b>Sam</b>\r\nBcc: x@example.com" });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).toContain("&lt;b&gt;Sam&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Sam</b>");
  });
});

describe("buildRequestConfirmation (ALL-71)", () => {
  it("the person gets a branded confirmation for access", () => {
    const email = buildRequestConfirmation(jordan);
    expect(email.to).toBe("jo@example.com");
    expect(email.replyTo).toBeUndefined();
    expect(email.text).toContain("We'll email you when you're in.");
    expect(email.html).toContain(EMAIL_LOGO_URL);
  });

  it("and for the waitlist", () => {
    const email = buildRequestConfirmation({ ...jordan, kind: "waitlist" });
    expect(email.to).toBe("jo@example.com");
    expect(email.text).toContain("You're on the concierge waitlist.");
    expect(email.text).toContain("We'll email you when it's ready.");
    expect(email.html).toContain(EMAIL_LOGO_URL);
  });
});

describe("requestAccess", () => {
  const ok = () => new Response(JSON.stringify({ id: "e1" }), { status: 200 });

  it("sends through Resend and thanks the visitor", async () => {
    const send = vi.fn(async () => ok());
    const result = await requestAccess(form({ name: "Jordan", email: "jo@example.com" }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(result).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(2);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(init.body))).toMatchObject({ reply_to: "jo@example.com", to: ["allensforever711+access@gmail.com"] });
  });

  it("sends to the owner first, then confirms to the person (ALL-71)", async () => {
    const send = vi.fn(async () => ok());
    await requestAccess(form({ name: "Jordan", email: "jo@example.com", kind: "waitlist" }), { isHuman: human, apiKey: "re_test", fetch: send });
    const to = send.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).to[0]);
    expect(to).toEqual(["allensforever711+waitlist@gmail.com", "jo@example.com"]);
  });

  it("still thanks the visitor if only their confirmation fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const result = await requestAccess(form({ name: "Jordan", email: "jo@example.com" }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(result).toEqual({ status: "sent" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("doesn't confirm to the person when the owner's email fails", async () => {
    const send = vi.fn(async () => new Response("nope", { status: 500 }));
    const result = await requestAccess(form({ name: "Jordan", email: "jo@example.com" }), { isHuman: human, apiKey: "re_test", fetch: send });
    expect(result).toMatchObject({ status: "error" });
    expect(send).toHaveBeenCalledTimes(1);
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
