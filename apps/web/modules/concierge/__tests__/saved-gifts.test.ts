import { describe, expect, it, vi } from "vitest";
import { parseSavedGiftForm } from "../saved-gifts/rules";
import { listSavedGifts, removeSavedGift, saveGift } from "../saved-gifts/service";
import { FakeSavedGiftsStore, ME, MY_PERSON, NOT_MINE } from "./fake-saved-gifts-store";

// Saved gifts for someone (ALL-93). The database's own rules are tested in
// supabase/tests/saved_gifts.test.sql; this covers the form and the messages.

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const REEL = { name: "Fly-fishing reel", priceCents: 4900, productUrl: "https://www.amazon.com/dp/B0TESTREEL", imageUrl: null };

describe("parseSavedGiftForm", () => {
  it("reads a name, price, link and photo", () => {
    expect(
      parseSavedGiftForm(form({ name: " Mug ", price: "12.50", link: "https://shop.example/mug", image: "https://shop.example/m.jpg" })),
    ).toEqual({
      ok: true,
      value: { name: "Mug", priceCents: 1250, productUrl: "https://shop.example/mug", imageUrl: "https://shop.example/m.jpg" },
    });
  });

  it("leaves out an empty price and link", () => {
    expect(parseSavedGiftForm(form({ name: "Mug", price: "", link: "" }))).toEqual({
      ok: true,
      value: { name: "Mug", priceCents: null, productUrl: null, imageUrl: null },
    });
  });

  it("needs a name", () => {
    expect(parseSavedGiftForm(form({ name: "  " }))).toEqual({ ok: false, error: "Give the gift a name." });
  });

  it("refuses a name over 200 characters", () => {
    expect(parseSavedGiftForm(form({ name: "n".repeat(201) }))).toEqual({
      ok: false,
      error: "Keep the name under 200 characters.",
    });
  });

  it("refuses a price it can't read, and one over $100,000", () => {
    expect(parseSavedGiftForm(form({ name: "Mug", price: "abc" }))).toEqual({
      ok: false,
      error: "Enter an amount like 75 or 75.50.",
    });
    expect(parseSavedGiftForm(form({ name: "Mug", price: "100001" }))).toEqual({
      ok: false,
      error: "Enter an amount up to $100,000.",
    });
  });

  it("refuses a link that isn't a web address", () => {
    expect(parseSavedGiftForm(form({ name: "Mug", link: "ftp://x.example/mug" }))).toEqual({
      ok: false,
      error: "That link doesn't look right.",
    });
  });

  it("drops a photo it can't use instead of failing the save", () => {
    const parsed = parseSavedGiftForm(form({ name: "Mug", image: "javascript:alert(1)" }));
    expect(parsed).toMatchObject({ ok: true, value: { imageUrl: null } });
    const long = parseSavedGiftForm(form({ name: "Mug", image: `https://x.example/${"i".repeat(2100)}` }));
    expect(long).toMatchObject({ ok: true, value: { imageUrl: null } });
  });
});

describe("saveGift", () => {
  it("saves a gift for the buyer's own person and logs ids only", async () => {
    const store = new FakeSavedGiftsStore();
    const log = vi.fn();
    expect(await saveGift(store, log, MY_PERSON, REEL)).toEqual({ ok: true });
    expect(store.rows).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("saved_gifts.save", { user_id: ME, person_id: MY_PERSON });
  });

  it("says the person wasn't found when they aren't the buyer's, or are deleted", async () => {
    const store = new FakeSavedGiftsStore();
    expect(await saveGift(store, vi.fn(), NOT_MINE, REEL)).toEqual({ ok: false, error: "That person wasn't found." });
    expect(store.writes).toEqual([]);
  });

  it("says the person wasn't found for an id that isn't one, without asking the database", async () => {
    const store = new FakeSavedGiftsStore();
    const insert = vi.spyOn(store, "insert");
    expect(await saveGift(store, vi.fn(), "not-an-id", REEL)).toEqual({ ok: false, error: "That person wasn't found." });
    expect(insert).not.toHaveBeenCalled();
  });

  it("explains the cap", async () => {
    const store = new FakeSavedGiftsStore();
    store.max = 0;
    expect(await saveGift(store, vi.fn(), MY_PERSON, REEL)).toEqual({
      ok: false,
      error: "You've saved as many gifts for them as we keep. Remove one to add another.",
    });
  });

  it("asks a signed-out caller to sign in", async () => {
    const store = new FakeSavedGiftsStore();
    store.caller = null;
    expect(await saveGift(store, vi.fn(), MY_PERSON, REEL)).toEqual({
      ok: false,
      error: "Your session ended. Sign in again.",
    });
  });

  it("says to try again when the database fails some other way", async () => {
    const store = new FakeSavedGiftsStore();
    vi.spyOn(store, "insert").mockRejectedValue(Object.assign(new Error("boom"), { code: "XX000" }));
    const log = vi.fn();
    expect(await saveGift(store, log, MY_PERSON, REEL)).toEqual({ ok: false, error: "That couldn't be saved. Try again." });
    expect(log).toHaveBeenCalledWith("saved_gifts.save_failed", expect.objectContaining({ person_id: MY_PERSON }));
  });
});

describe("removeSavedGift", () => {
  it("removes a gift and logs ids only", async () => {
    const store = new FakeSavedGiftsStore();
    await saveGift(store, vi.fn(), MY_PERSON, REEL);
    const id = store.rows[0].id;
    const log = vi.fn();
    expect(await removeSavedGift(store, log, MY_PERSON, id)).toEqual({ ok: true });
    expect(store.rows).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("saved_gifts.remove", { user_id: ME, person_id: MY_PERSON });
  });

  it("is fine with a gift that's already gone", async () => {
    const store = new FakeSavedGiftsStore();
    expect(await removeSavedGift(store, vi.fn(), MY_PERSON, "33333333-3333-4333-8333-333333333333")).toEqual({ ok: true });
  });
});

describe("listSavedGifts", () => {
  it("returns the gifts in the store's order, in the page's shape", async () => {
    const store = new FakeSavedGiftsStore();
    await saveGift(store, vi.fn(), MY_PERSON, REEL);
    await saveGift(store, vi.fn(), MY_PERSON, { ...REEL, name: "Coffee", productUrl: null, priceCents: null });
    const gifts = await listSavedGifts(store, MY_PERSON);
    expect(gifts.map((g) => g.name)).toEqual(["Coffee", "Fly-fishing reel"]);
    expect(gifts[1]).toEqual({
      id: expect.any(String),
      name: "Fly-fishing reel",
      priceCents: 4900,
      productUrl: "https://www.amazon.com/dp/B0TESTREEL",
      imageUrl: null,
    });
  });

  it("returns nothing for an id that isn't one", async () => {
    expect(await listSavedGifts(new FakeSavedGiftsStore(), "nope")).toEqual([]);
  });
});
