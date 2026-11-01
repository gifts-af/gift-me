// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { parseCaptureForm, saveCapture } from "../capture/capture";
import type { CaptureInput } from "../capture/capture";
import { FakeCaptureStore } from "./fake-capture-store";

let store: FakeCaptureStore;
let consoleError: MockInstance<typeof console.error>;

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
  // Store failures are logged; keep that out of the test output.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
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

  it("logs a failing upload once, with the step name and the error only", async () => {
    store.failUpload = true;
    await saveCapture(store, input({ note: "secret note", text: "secret text" }));
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [message, err] = consoleError.mock.calls[0];
    expect(message).toBe("capture: upload failed");
    expect(err).toBeInstanceOf(Error);
    expect(consoleError.mock.calls[0]).toHaveLength(2);
  });

  it.each([
    ["limits", "failLimits"],
    ["person check", "failPersonCheck"],
    ["insert", "failInsert"],
    ["set path", "failSetPath"],
  ] as const)("logs the %s step when it fails", async (step, flag) => {
    store[flag] = true;
    const r = await saveCapture(store, input());
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(`capture: ${step} failed`, expect.any(Error));
  });

  it("logs both the upload and a failing rollback delete", async () => {
    store.failUpload = true;
    store.failDelete = true;
    const r = await saveCapture(store, input());
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(consoleError.mock.calls.map((c) => c[0])).toEqual([
      "capture: upload failed",
      "capture: rollback delete failed",
    ]);
  });

  it("logs nothing when the save succeeds", async () => {
    await saveCapture(store, input());
    expect(consoleError).not.toHaveBeenCalled();
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

  it("rejects a note over 2000 characters", () => {
    expect(parseCaptureForm(form({ person_id: "p1", screenshot: shot(), note: "a".repeat(2001) }))).toBeNull();
    expect(parseCaptureForm(form({ person_id: "p1", screenshot: shot(), note: "a".repeat(2000) }))).not.toBeNull();
  });

  it("rejects an empty screenshot or one that isn't a JPEG", () => {
    expect(parseCaptureForm(form({ person_id: "p1", screenshot: new Blob([], { type: "image/jpeg" }) }))).toBeNull();
    expect(parseCaptureForm(form({ person_id: "p1", screenshot: new Blob(["x"], { type: "image/png" }) }))).toBeNull();
    // An untyped part is still accepted.
    expect(parseCaptureForm(form({ person_id: "p1", screenshot: new Blob(["x"]) }))).not.toBeNull();
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
