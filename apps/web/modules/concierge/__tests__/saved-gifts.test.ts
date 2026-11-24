import { describe, expect, it, vi } from "vitest";
import { NOT_FOUND } from "../people/service";
import { parseSavedGiftForm } from "../saved-gifts/rules";
import { IDEA_REPLACED, countSavedGifts, listSavedGifts, removeSavedGift, saveGift, saveIdea, savedProductIds } from "../saved-gifts/service";
import { FakeSavedGiftsStore, IDEA, ME, MY_PERSON, NOT_MINE } from "./fake-saved-gifts-store";

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

// The Saved gifts row on a person's page shows only how many (ALL-127).
describe("countSavedGifts", () => {
  it("counts a person's gifts without loading them", async () => {
    const store = new FakeSavedGiftsStore();
    await saveGift(store, vi.fn(), MY_PERSON, REEL);
    await saveGift(store, vi.fn(), MY_PERSON, { ...REEL, name: "Coffee" });
    const list = vi.spyOn(store, "list");
    expect(await countSavedGifts(store, MY_PERSON)).toBe(2);
    expect(list).not.toHaveBeenCalled();
  });

  it("is 0 for an id that isn't one, without asking the store", async () => {
    const store = new FakeSavedGiftsStore();
    const count = vi.spyOn(store, "count");
    expect(await countSavedGifts(store, "nope")).toBe(0);
    expect(count).not.toHaveBeenCalled();
  });
});

// "Save" on a suggested idea (ALL-128). The server copies the idea itself; the
// browser sends only its id. The one-copy rule is the database's
// (supabase/tests/saved_gifts.test.sql); the fake mirrors its 23505.
describe("saveIdea", () => {
  function storeWithIdea(overrides: Partial<FakeSavedGiftsStore["ideas"][string]> = {}) {
    const store = new FakeSavedGiftsStore();
    store.ideas[IDEA] = {
      person_id: MY_PERSON,
      title: "Fly-tying vise",
      price_cents: 3999,
      product_url: "https://www.amazon.com/dp/B0TESTVISE",
      image_url: "https://m.media-amazon.com/images/I/vise.jpg",
      retailer_product_id: "B0TESTVISE",
      ...overrides,
    };
    return store;
  }

  it("copies the idea's title, item price, link, photo and product id, and logs ids only", async () => {
    const store = storeWithIdea();
    const log = vi.fn();
    expect(await saveIdea(store, log, MY_PERSON, IDEA)).toEqual({ ok: true });
    expect(store.rows).toEqual([
      expect.objectContaining({
        person_id: MY_PERSON,
        name: "Fly-tying vise",
        price_cents: 3999,
        product_url: "https://www.amazon.com/dp/B0TESTVISE",
        image_url: "https://m.media-amazon.com/images/I/vise.jpg",
        retailer_product_id: "B0TESTVISE",
      }),
    ]);
    expect(log).toHaveBeenCalledWith("saved_gifts.save_idea", { user_id: ME, person_id: MY_PERSON, idea_id: IDEA });
  });

  it.each([
    ["none", null],
    ["too long to keep", `https://m.media-amazon.com/${"x".repeat(2048)}`],
  ])("saves without a photo when the idea's is %s", async (_, image_url) => {
    const store = storeWithIdea({ image_url });
    expect(await saveIdea(store, vi.fn(), MY_PERSON, IDEA)).toEqual({ ok: true });
    expect(store.rows[0].image_url).toBeNull();
  });

  it("cuts a long product title to the 200 characters a saved gift keeps", async () => {
    const store = storeWithIdea({ title: `${"x".repeat(199)}yz` });
    await saveIdea(store, vi.fn(), MY_PERSON, IDEA);
    expect(store.rows[0].name).toBe(`${"x".repeat(199)}…`);
  });

  it("cuts by characters, never through an emoji", async () => {
    const store = storeWithIdea({ title: `${"x".repeat(198)}🎣🎣🎣` });
    await saveIdea(store, vi.fn(), MY_PERSON, IDEA);
    expect(store.rows[0].name).toBe(`${"x".repeat(198)}🎣…`);
  });

  it("says Saved, not the cap message, when a stale tab saves a product already saved at the cap", async () => {
    const store = storeWithIdea();
    await saveIdea(store, vi.fn(), MY_PERSON, IDEA);
    store.max = 1;
    expect(await saveIdea(store, vi.fn(), MY_PERSON, IDEA)).toEqual({ ok: true });
    expect(store.rows).toHaveLength(1);
  });

  it("says the idea was replaced when a newer run removed it", async () => {
    const store = new FakeSavedGiftsStore();
    expect(await saveIdea(store, vi.fn(), MY_PERSON, IDEA)).toEqual({ ok: false, error: IDEA_REPLACED });
    expect(IDEA_REPLACED).toBe("This idea was replaced. Refresh to see the new ones.");
    expect(store.writes).toEqual([]);
  });

  it("doesn't copy an idea for another person, and logs the mismatch", async () => {
    const store = storeWithIdea({ person_id: NOT_MINE });
    const log = vi.fn();
    expect(await saveIdea(store, log, MY_PERSON, IDEA)).toEqual({ ok: false, error: IDEA_REPLACED });
    expect(store.writes).toEqual([]);
    expect(log).toHaveBeenCalledWith("saved_gifts.save_idea_wrong_person", { user_id: ME, person_id: MY_PERSON, idea_id: IDEA });
  });

  it("treats a second save of the same product as already saved", async () => {
    const store = storeWithIdea();
    await saveIdea(store, vi.fn(), MY_PERSON, IDEA);
    expect(await saveIdea(store, vi.fn(), MY_PERSON, IDEA)).toEqual({ ok: true });
    expect(store.rows).toHaveLength(1);
  });

  it("refuses at the cap with the saved-gifts message", async () => {
    const store = storeWithIdea();
    store.max = 0;
    expect(await saveIdea(store, vi.fn(), MY_PERSON, IDEA)).toEqual({
      ok: false,
      error: "You've saved as many gifts for them as we keep. Remove one to add another.",
    });
  });

  it("refuses ids that aren't ids, and a signed-out caller, without reading", async () => {
    const store = storeWithIdea();
    const idea = vi.spyOn(store, "idea");
    expect(await saveIdea(store, vi.fn(), MY_PERSON, "nope")).toEqual({ ok: false, error: NOT_FOUND });
    expect(await saveIdea(store, vi.fn(), "nope", IDEA)).toEqual({ ok: false, error: NOT_FOUND });
    store.caller = null;
    expect((await saveIdea(store, vi.fn(), MY_PERSON, IDEA)).ok).toBe(false);
    expect(idea).not.toHaveBeenCalled();
  });
});

describe("savedProductIds", () => {
  it("lists the product ids saved for a person, skipping gifts typed in by hand", async () => {
    const store = new FakeSavedGiftsStore();
    store.ideas[IDEA] = { person_id: MY_PERSON, title: "Vise", price_cents: 3999, product_url: null, image_url: null, retailer_product_id: "B0TESTVISE" };
    await saveIdea(store, vi.fn(), MY_PERSON, IDEA);
    await saveGift(store, vi.fn(), MY_PERSON, REEL);
    expect(await savedProductIds(store, MY_PERSON)).toEqual(["B0TESTVISE"]);
  });

  it("is empty for an id that isn't one", async () => {
    expect(await savedProductIds(new FakeSavedGiftsStore(), "nope")).toEqual([]);
  });
});
