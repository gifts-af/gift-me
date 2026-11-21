import { afterEach, describe, expect, it, vi } from "vitest";
import { addToMyList, retryExtraction, uploadCapture, type AddInput, type CaptureInput } from "../upload";

vi.mock("../config", () => ({ config: { appOrigin: "https://app.test" } }));

const input: CaptureInput = {
  personId: "p1",
  url: "https://shop.test/item",
  title: "Item",
  text: "A lovely mug.",
  note: "She loved this",
  screenshot: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
};

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("uploadCapture", () => {
  it("posts multipart with every field and the bearer token", async () => {
    const fetchMock = stubFetch(json({ id: "c1" }, 201));
    expect(await uploadCapture("tok", input)).toEqual({ ok: true, id: "c1", extraction: null });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.test/api/captures");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
    const form = init.body as FormData;
    expect(form.get("person_id")).toBe("p1");
    expect(form.get("url")).toBe("https://shop.test/item");
    expect(form.get("title")).toBe("Item");
    expect(form.get("text")).toBe("A lovely mug.");
    expect(form.get("note")).toBe("She loved this");
    const file = form.get("screenshot") as File;
    expect(file.name).toBe("screenshot.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(3);
  });

  it("leaves the note out when there isn't one", async () => {
    const fetchMock = stubFetch(json({ id: "c1" }, 201));
    await uploadCapture("tok", { ...input, note: null });
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.has("note")).toBe(false);
  });

  it.each([400, 401, 404, 413, 500])("returns the server's error for %i", async (status) => {
    stubFetch(json({ error: "Nope." }, status));
    expect(await uploadCapture("tok", input)).toEqual({ ok: false, status, error: "Nope." });
  });

  it("falls back to a plain sentence when the error body isn't JSON", async () => {
    stubFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(await uploadCapture("tok", input)).toEqual({
      ok: false,
      status: 502,
      error: "Couldn't save the capture. Try again.",
    });
  });

  it("maps a network failure to status 0", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    expect(await uploadCapture("tok", input)).toEqual({
      ok: false,
      status: 0,
      error: "Couldn't reach GiftsAF. Check your connection.",
    });
  });
});

describe("uploadCapture: what was learned (ALL-25)", () => {
  const extraction = { status: "extracted", facts: [{ id: "f1", category: "owns", value: "Owala water bottle" }] };

  it("returns the extraction the server sends", async () => {
    stubFetch(json({ id: "c1", extraction }, 201));
    expect(await uploadCapture("tok", input)).toEqual({ ok: true, id: "c1", extraction });
  });

  it.each([
    ["no extraction", { id: "c1" }],
    ["an unknown status", { id: "c1", extraction: { status: "odd", facts: [] } }],
    ["facts that aren't a list", { id: "c1", extraction: { status: "extracted", facts: "x" } }],
    ["a fact with an unknown category", { id: "c1", extraction: { status: "extracted", facts: [{ id: "f", category: "mood", value: "x" }] } }],
  ])("treats %s as no extraction", async (_label, body) => {
    stubFetch(json(body, 201));
    expect(await uploadCapture("tok", input)).toEqual({ ok: true, id: "c1", extraction: null });
  });
});

describe("retryExtraction", () => {
  it("posts to the capture's extract route with the bearer token", async () => {
    const extraction = { status: "extracted", facts: [] };
    const fetchMock = stubFetch(json({ extraction }, 200));
    expect(await retryExtraction("tok", "c1")).toEqual({ ok: true, extraction });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.test/api/captures/c1/extract");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("passes on the server's error", async () => {
    stubFetch(json({ error: "That capture wasn't found." }, 404));
    expect(await retryExtraction("tok", "c1")).toEqual({ ok: false, status: 404, error: "That capture wasn't found." });
  });

  it("says when the network is down", async () => {
    stubFetch(new TypeError("offline"));
    expect(await retryExtraction("tok", "c1")).toEqual({ ok: false, status: 0, error: "Couldn't reach GiftsAF. Check your connection." });
  });
});

describe("addToMyList (ALL-78)", () => {
  const add: AddInput = {
    name: "YETI Rambler 20 oz Tumbler",
    priceCents: 3500,
    pageUrl: "https://www.rei.com/product/1?ref=x",
    canonicalUrl: "https://www.rei.com/product/1",
    productId: "SKU-1",
    photo: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
  };

  it("posts version 1 multipart with every field and the bearer token", async () => {
    const fetchMock = stubFetch(json({ outcome: "added", itemId: "i1" }, 201));
    expect(await addToMyList("tok", add)).toEqual({ ok: true, outcome: "added" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://app.test/api/lists/items");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
    const form = init.body as FormData;
    expect(form.get("v")).toBe("1");
    expect(form.get("name")).toBe("YETI Rambler 20 oz Tumbler");
    expect(form.get("priceCents")).toBe("3500");
    expect(form.get("pageUrl")).toBe("https://www.rei.com/product/1?ref=x");
    expect(form.get("canonicalUrl")).toBe("https://www.rei.com/product/1");
    expect(form.get("productId")).toBe("SKU-1");
    expect(form.get("photo")).toBeInstanceOf(Blob);
    expect(form.has("confirmLikely")).toBe(false);
  });

  it("leaves out what isn't there, and sends confirmLikely=1 when asked", async () => {
    const fetchMock = stubFetch(json({ outcome: "added", itemId: "i1" }, 201));
    await addToMyList("tok", { ...add, canonicalUrl: null, productId: null, photo: null, confirmLikely: true });
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.has("canonicalUrl")).toBe(false);
    expect(form.has("productId")).toBe(false);
    expect(form.has("photo")).toBe(false);
    expect(form.get("confirmLikely")).toBe("1");
  });

  it.each([
    [{ outcome: "duplicate" }, { ok: true, outcome: "duplicate" }],
    [{ outcome: "full" }, { ok: true, outcome: "full" }],
    [
      { outcome: "likely", existing: { name: "Rambler", priceCents: 3000, imageUrl: null } },
      { ok: true, outcome: "likely", existing: { name: "Rambler", priceCents: 3000, imageUrl: null } },
    ],
  ])("reads the 200 outcome %j", async (body, expected) => {
    stubFetch(json(body, 200));
    expect(await addToMyList("tok", add)).toEqual(expected);
  });

  it("an unreadable likely answer is an error, not a guess", async () => {
    stubFetch(json({ outcome: "likely", existing: { name: 3 } }, 200));
    expect(await addToMyList("tok", add)).toEqual({ ok: false, status: 200, error: "Couldn't add that gift. Try again." });
  });

  it.each([404, 503])("a %i says adding is paused (the route is off or rolled back)", async (status) => {
    stubFetch(new Response("<html>Not found</html>", { status }));
    expect(await addToMyList("tok", add)).toEqual({ ok: false, status, error: "Adding from the extension is paused." });
  });

  it("marks a refused photo, so the popup can offer to add without it", async () => {
    stubFetch(json({ error: "That photo couldn't be used.", code: "photo" }, 400));
    expect(await addToMyList("tok", add)).toEqual({ ok: false, status: 400, error: "That photo couldn't be used.", photoRefused: true });
  });

  it("passes on the server's error, and maps a network failure to status 0", async () => {
    stubFetch(json({ error: "Sign in again." }, 401));
    expect(await addToMyList("tok", add)).toEqual({ ok: false, status: 401, error: "Sign in again." });
    stubFetch(new TypeError("Failed to fetch"));
    expect(await addToMyList("tok", add)).toEqual({ ok: false, status: 0, error: "Couldn't reach GiftsAF. Check your connection." });
  });
});
