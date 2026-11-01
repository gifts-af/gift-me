// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { parseCaptureForm, saveCapture } from "../capture/capture";
import type { CaptureInput } from "../capture/capture";
import { FakeCaptureStore } from "./fake-capture-store";

let store: FakeCaptureStore;

function input(over: Partial<CaptureInput> = {}): CaptureInput {
  return {
    personId: "p1",
    url: "https://example.com/x",
    title: "A page",
    text: "hello",
    note: null,
    screenshot: new Blob(["jpegbytes"], { type: "image/jpeg" }),
    ...over,
  };
}

beforeEach(() => {
  store = new FakeCaptureStore();
  store.people.add("p1");
});

describe("saveCapture", () => {
  it("trims text to textMaxChars", async () => {
    const r = await saveCapture(store, input({ text: "a".repeat(21000) }));
    expect(r.ok).toBe(true);
    expect(store.rows[0].text).toHaveLength(20000);
  });

  it("rejects a screenshot over the limit with 413 and writes nothing", async () => {
    store.limitValues.screenshotMaxBytes = 4;
    const r = await saveCapture(store, input());
    expect(r).toMatchObject({ ok: false, status: 413 });
    expect(store.rows).toHaveLength(0);
    expect(store.uploads.size).toBe(0);
  });

  it("returns 404 for an unknown or foreign person and writes nothing", async () => {
    const r = await saveCapture(store, input({ personId: "someone-else" }));
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(store.rows).toHaveLength(0);
    expect(store.uploads.size).toBe(0);
  });

  it("stores row then screenshot at {userId}/{id}.jpg and sets screenshot_path", async () => {
    const r = await saveCapture(store, input({ note: "for dad" }));
    expect(r).toEqual({ ok: true, id: "cap-1" });
    expect(store.uploads.has("user-1/cap-1.jpg")).toBe(true);
    expect(store.rows[0]).toMatchObject({
      note: "for dad",
      screenshotPath: "user-1/cap-1.jpg",
    });
  });

  it("deletes the row and returns 500 when the upload throws", async () => {
    store.failUpload = true;
    const r = await saveCapture(store, input());
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(store.rows).toHaveLength(0);
  });

  it("deletes the row and returns 500 when setting the path throws", async () => {
    store.failSetPath = true;
    const r = await saveCapture(store, input());
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(store.rows).toHaveLength(0);
  });
});

describe("parseCaptureForm", () => {
  function form(fields: Record<string, string | Blob>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  }
  const shot = () => new Blob(["x"], { type: "image/jpeg" });

  it("returns null when person_id or screenshot is missing", () => {
    expect(parseCaptureForm(form({ screenshot: shot() }))).toBeNull();
    expect(parseCaptureForm(form({ person_id: "p1" }))).toBeNull();
    expect(parseCaptureForm(form({ person_id: "p1", screenshot: "text" }))).toBeNull();
  });

  it("parses fields, defaults absent ones, and turns blank notes into null", () => {
    const a = parseCaptureForm(form({ person_id: "p1", screenshot: shot(), note: "   " }));
    expect(a).toMatchObject({ personId: "p1", url: "", title: "", text: "", note: null });
    const b = parseCaptureForm(
      form({ person_id: "p1", screenshot: shot(), note: " hi ", url: "u", title: "t", text: "x" }),
    );
    expect(b).toMatchObject({ url: "u", title: "t", text: "x", note: "hi" });
  });
});
