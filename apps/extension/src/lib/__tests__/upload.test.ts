import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadCapture, type CaptureInput } from "../upload";

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
    expect(await uploadCapture("tok", input)).toEqual({ ok: true, id: "c1" });

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
