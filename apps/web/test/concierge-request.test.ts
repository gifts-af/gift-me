import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildAccessConfirmation,
  buildAccessRequest,
  claimAccessRequest,
  hasConciergeAccess,
  releaseAccessRequest,
  requestConciergeAccess,
} from "@/modules/concierge";

const user = { id: "u1", email: "jordan@example.test", name: "Jordan Rivera" };

function setup(claimed: "claimed" | "already" | "busy" = "claimed") {
  const calls: string[] = [];
  const deps = {
    claim: vi.fn(async () => {
      calls.push("claim");
      return claimed;
    }),
    release: vi.fn(async () => {
      calls.push("release");
    }),
    sendOwner: vi.fn(async (): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
      calls.push("owner");
      return { ok: true, id: "1" };
    }),
    sendPerson: vi.fn(async (): Promise<{ ok: true; id: string } | { ok: false; error: string }> => {
      calls.push("person");
      return { ok: true, id: "2" };
    }),
    log: vi.fn(),
  };
  /** Every logged event carries the user id and nothing else (E6). */
  const events = () =>
    deps.log.mock.calls.map(([event, fields]) => {
      expect(fields).toEqual({ user_id: "u1" });
      return event;
    });
  return { deps, calls, events };
}

describe("requestConciergeAccess", () => {
  it("claims, then emails the owner, then the person (AC-6)", async () => {
    const { deps, calls, events } = setup();
    expect(await requestConciergeAccess(user, deps)).toEqual({ status: "sent" });
    expect(calls).toEqual(["claim", "owner", "person"]);
    expect(deps.claim).toHaveBeenCalledWith("u1");
    expect(deps.sendOwner).toHaveBeenCalledWith(user);
    expect(deps.sendPerson).toHaveBeenCalledWith(user);
    expect(events()).toEqual(["concierge_access.requested"]);
  });

  it("sends nothing when they already asked (AC-6)", async () => {
    const { deps, calls } = setup("already");
    expect(await requestConciergeAccess(user, deps)).toEqual({ status: "sent" });
    expect(calls).toEqual(["claim"]);
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("sends nothing and says busy at the cap (AC-18)", async () => {
    const { deps, calls, events } = setup("busy");
    expect(await requestConciergeAccess(user, deps)).toEqual({ status: "busy" });
    expect(calls).toEqual(["claim"]);
    expect(events()).toEqual(["concierge_access.busy"]);
  });

  it("gives the claim back, and sends no copy, when the owner's email fails (AC-6)", async () => {
    const { deps, calls, events } = setup();
    deps.sendOwner.mockResolvedValue({ ok: false, error: "Resend responded 500 for jordan@example.test" });
    expect(await requestConciergeAccess(user, deps)).toEqual({ status: "error" });
    expect(calls).toEqual(["claim", "release"]);
    expect(deps.release).toHaveBeenCalledWith("u1");
    expect(deps.sendPerson).not.toHaveBeenCalled();
    expect(events()).toEqual(["concierge_access.request_email_failed"]);
  });

  it("is still sent when only the person's copy fails", async () => {
    const { deps, events } = setup();
    deps.sendPerson.mockResolvedValue({ ok: false, error: "Resend responded 422 for jordan@example.test" });
    expect(await requestConciergeAccess(user, deps)).toEqual({ status: "sent" });
    expect(deps.release).not.toHaveBeenCalled();
    expect(events()).toEqual(["concierge_access.requested", "concierge_access.confirmation_failed"]);
  });
});

describe("the request emails", () => {
  it("tells the owner who asked, and replies go to the person (AC-6)", () => {
    const email = buildAccessRequest(user);
    expect(email.to).toBe("allensforever711+access@gmail.com");
    expect(email.replyTo).toBe("jordan@example.test");
    expect(email.subject).toBe("GiftsAF concierge request: Jordan Rivera");
    for (const body of [email.html, email.text]) {
      expect(body).toContain("Jordan Rivera");
      expect(body).toContain("jordan@example.test");
      expect(body).toContain("operations.md");
    }
  });

  it("keeps a name with line breaks on one line", () => {
    const email = buildAccessRequest({ ...user, name: "Jordan\r\nBcc: x@example.test Rivera" });
    expect(email.subject).toBe("GiftsAF concierge request: Jordan Bcc: x@example.test Rivera");
    expect(email.text).toContain("Jordan Bcc: x@example.test Rivera");
    expect(email.text).not.toMatch(/^Bcc:/m);
  });

  it.each([null, " \r\n "])("uses the email when there's no name (%j)", (name) => {
    expect(buildAccessRequest({ ...user, name }).subject).toBe("GiftsAF concierge request: jordan@example.test");
  });

  it("sends the person a copy with nothing they typed", () => {
    const email = buildAccessConfirmation(user);
    expect(email.to).toBe("jordan@example.test");
    expect(email.replyTo).toBeUndefined();
    expect(email.text).toContain("Got it.");
    expect(email.text).toContain("Thanks, we got your request. We'll email you when you're in.");
    for (const part of [email.subject, email.html, email.text]) {
      expect(part).not.toContain("Jordan");
      expect(part).not.toContain("jordan@example.test");
    }
  });
});

// The database's side of these runs in concierge_access.test.sql and open-signup.spec.ts.
type Reply = { data: unknown; error: { message: string } | null };
function db(reply: Reply) {
  const rpc = vi.fn(async () => reply);
  return { rpc, client: { schema: () => ({ rpc }) } as unknown as Parameters<typeof hasConciergeAccess>[0] };
}

describe("reading and claiming access", () => {
  it("hasConciergeAccess answers true or false for this user", async () => {
    const on = db({ data: true, error: null });
    expect(await hasConciergeAccess(on.client, "u1")).toBe(true);
    expect(on.rpc).toHaveBeenCalledWith("has_concierge_access", { p_user_id: "u1" });
    expect(await hasConciergeAccess(db({ data: false, error: null }).client, "u1")).toBe(false);
  });

  it("hasConciergeAccess throws when the check fails, rather than guess", async () => {
    await expect(hasConciergeAccess(db({ data: null, error: { message: "down" } }).client, "u1")).rejects.toThrow("down");
  });

  it.each(["claimed", "already", "busy"] as const)("claimAccessRequest passes on %s", async (answer) => {
    expect(await claimAccessRequest(db({ data: answer, error: null }).client, "u1")).toBe(answer);
  });

  it("claimAccessRequest throws on an error or an answer it doesn't know", async () => {
    await expect(claimAccessRequest(db({ data: null, error: { message: "down" } }).client, "u1")).rejects.toThrow("down");
    await expect(claimAccessRequest(db({ data: "later", error: null }).client, "u1")).rejects.toThrow();
  });

  it("releaseAccessRequest throws when it fails", async () => {
    await expect(releaseAccessRequest(db({ data: null, error: { message: "down" } }).client, "u1")).rejects.toThrow("down");
    await expect(releaseAccessRequest(db({ data: null, error: null }).client, "u1")).resolves.toBeUndefined();
  });
});
