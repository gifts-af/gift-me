import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIONS, type ActionName } from "../notify/actions";
import { confirmActionLink, readActionLink } from "../notify/links";
import { hashActionToken } from "../notify/tokens";
import { FakeStore } from "./fake-store";

const OWNER = "owner-1";
const OTHER = "other-1";
const TOKEN = "a-real-token";
const NOW = new Date("2026-11-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;

async function storeWithLink(
  opts: { expiresAt?: Date; usedAt?: Date | null; action?: string } = {},
): Promise<FakeStore> {
  const store = new FakeStore();
  store.recipients.set(OWNER, { email: "mom@example.com", timezone: null });
  await store.insertLinks([
    {
      hash: hashActionToken(TOKEN),
      userId: OWNER,
      roundId: null,
      // A link saved by another build can name an action this build lacks.
      action: (opts.action ?? "test") as ActionName,
      expiresAt: opts.expiresAt ?? new Date(NOW.getTime() + HOUR),
    },
  ]);
  if (opts.usedAt) store.links[0].usedAt = opts.usedAt;
  return store;
}

const usedLink = () => storeWithLink({ usedAt: new Date(NOW.getTime() - HOUR) });
const expiredLink = () => storeWithLink({ expiresAt: new Date(NOW.getTime() - 1) });

afterEach(() => vi.restoreAllMocks());

describe("readActionLink", () => {
  it("is invalid for an unknown token, even when signed out", async () => {
    const store = await storeWithLink();
    expect(await readActionLink("made-up", null, { store, now: NOW })).toEqual({
      state: "invalid",
    });
    expect(await readActionLink("made-up", OWNER, { store, now: NOW })).toEqual({
      state: "invalid",
    });
  });

  it("asks a signed-out visitor to sign in, with the owner's email as the hint", async () => {
    const store = await storeWithLink();
    expect(await readActionLink(TOKEN, null, { store, now: NOW })).toEqual({
      state: "sign_in",
      email: "mom@example.com",
    });
  });

  it("asks a signed-out visitor to sign in even for a used or expired link", async () => {
    for (const store of [await usedLink(), await expiredLink()]) {
      expect(await readActionLink(TOKEN, null, { store, now: NOW })).toEqual({
        state: "sign_in",
        email: "mom@example.com",
      });
    }
  });

  it("tells a different account the link isn't theirs and shows no action text", async () => {
    for (const store of [await storeWithLink(), await usedLink(), await expiredLink()]) {
      const view = await readActionLink(TOKEN, OTHER, { store, now: NOW });
      expect(view).toEqual({ state: "wrong_account" });
      const text = JSON.stringify(view);
      expect(text).not.toContain(ACTIONS.test.confirm.title);
      expect(text).not.toContain(ACTIONS.test.confirm.body);
    }
  });

  it("says used before expired", async () => {
    const store = await storeWithLink({
      usedAt: new Date(NOW.getTime() - 2 * HOUR),
      expiresAt: new Date(NOW.getTime() - HOUR),
    });
    expect(await readActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({ state: "used" });
  });

  it("says expired for the owner once expiry has passed", async () => {
    const store = await expiredLink();
    expect(await readActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
      state: "expired",
    });
  });

  it("treats a link expiring exactly now as expired, like claimLink", async () => {
    const store = await storeWithLink({ expiresAt: NOW });
    expect(await readActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
      state: "expired",
    });
  });

  it("shows the owner the confirm page with the action's own words", async () => {
    const store = await storeWithLink();
    expect(await readActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
      state: "confirm",
      confirm: ACTIONS.test.confirm,
    });
  });

  it("never uses up the link or runs the action (AC-3)", async () => {
    const store = await storeWithLink();
    const run = vi.spyOn(ACTIONS.test, "run");
    const claim = vi.spyOn(store, "claimLink");
    await readActionLink(TOKEN, OWNER, { store, now: NOW });
    await readActionLink(TOKEN, OWNER, { store, now: NOW });
    expect(store.links[0].usedAt).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("confirmActionLink", () => {
  it("runs the action once, marks the link used and returns done", async () => {
    const store = await storeWithLink();
    const run = vi.spyOn(ACTIONS.test, "run");
    const result = await confirmActionLink(TOKEN, OWNER, { store, now: NOW });
    expect(result).toEqual({ state: "done", done: ACTIONS.test.done });
    expect(ACTIONS.test.done.body).toBe("It works. Buttons in our emails will look like this.");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ userId: OWNER, roundId: null });
    expect(store.links[0].usedAt).toEqual(NOW);
  });

  it("returns used on a second confirm and doesn't run again (AC-5)", async () => {
    const store = await storeWithLink();
    const run = vi.spyOn(ACTIONS.test, "run");
    await confirmActionLink(TOKEN, OWNER, { store, now: NOW });
    expect(await confirmActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
      state: "used",
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs the action exactly once under two concurrent confirms", async () => {
    const store = await storeWithLink();
    const run = vi.spyOn(ACTIONS.test, "run");
    const results = await Promise.all([
      confirmActionLink(TOKEN, OWNER, { store, now: NOW }),
      confirmActionLink(TOKEN, OWNER, { store, now: NOW }),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.state).sort()).toEqual(["done", "used"]);
  });

  it("returns expired and never runs the action (AC-6)", async () => {
    const store = await expiredLink();
    const run = vi.spyOn(ACTIONS.test, "run");
    expect(await confirmActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
      state: "expired",
    });
    expect(run).not.toHaveBeenCalled();
    expect(store.links[0].usedAt).toBeNull();
  });

  it("acts on nothing for invalid, signed-out or wrong-account requests", async () => {
    const store = await storeWithLink();
    const run = vi.spyOn(ACTIONS.test, "run");
    expect(await confirmActionLink("made-up", OWNER, { store, now: NOW })).toEqual({
      state: "invalid",
    });
    expect(await confirmActionLink(TOKEN, null, { store, now: NOW })).toEqual({
      state: "sign_in",
      email: "mom@example.com",
    });
    expect(await confirmActionLink(TOKEN, OTHER, { store, now: NOW })).toEqual({
      state: "wrong_account",
    });
    expect(run).not.toHaveBeenCalled();
    expect(store.links[0].usedAt).toBeNull();
  });

  it("returns invalid and logs (without the token) when the action fails; the link stays used", async () => {
    const store = await storeWithLink();
    vi.spyOn(ACTIONS.test, "run").mockResolvedValue({ ok: false, error: "boom" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await confirmActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
      state: "invalid",
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).toContain("boom");
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    expect(store.links[0].usedAt).toEqual(NOW);
  });

  it("is invalid on read and confirm for an action this build doesn't know, and runs nothing", async () => {
    for (const name of ["retired-action", "constructor", "toString"]) {
      const store = await storeWithLink({ action: name });
      const run = vi.spyOn(ACTIONS.test, "run");
      expect(await readActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({ state: "invalid" });
      expect(await confirmActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
        state: "invalid",
      });
      expect(run).not.toHaveBeenCalled();
      expect(store.links[0].usedAt).toBeNull();
    }
  });

  it("treats an action that throws like a failure: logged without the token, link stays used", async () => {
    const store = await storeWithLink();
    vi.spyOn(ACTIONS.test, "run").mockRejectedValue(new Error("kaboom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await confirmActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
      state: "invalid",
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).toContain("kaboom");
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    expect(store.links[0].usedAt).toEqual(NOW);
  });

  it("open_person: done page carries a link to the round's person (ALL-28)", async () => {
    const store = await storeWithLink({ action: "open_person" });
    store.links[0].roundId = "round-1";
    store.roundPeople.set("round-1", "person-1");
    expect(ACTIONS.open_person.confirm.button).toBeTruthy();
    expect(await confirmActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
      state: "done",
      done: ACTIONS.open_person.done,
      next: "/people/person-1",
    });
  });

  it("open_person: no round or person means a plain done page", async () => {
    const store = await storeWithLink({ action: "open_person" });
    expect(await confirmActionLink(TOKEN, OWNER, { store, now: NOW })).toEqual({
      state: "done",
      done: ACTIONS.open_person.done,
    });
  });
});
