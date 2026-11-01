// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const createStore = vi.fn();
vi.mock("@/modules/concierge", async () => {
  const actual = await vi.importActual<typeof import("@/modules/concierge/capture/capture")>(
    "@/modules/concierge/capture/capture",
  );
  return {
    parseCaptureForm: actual.parseCaptureForm,
    saveCapture: actual.saveCapture,
    createSupabaseCaptureStore: (token: string) => createStore(token),
  };
});

import { OPTIONS, POST } from "../route";

const ID = "abcdefghijklmnop";
const ORIGIN = `chrome-extension://${ID}`;

function form(overrides: Record<string, string | Blob> = {}) {
  const f = new FormData();
  f.set("person_id", "p1");
  f.set("url", "https://shop.test/x");
  f.set("title", "Thing");
  f.set("text", "hello");
  f.set("screenshot", new Blob(["jpg"], { type: "image/jpeg" }), "s.jpg");
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}

function post(headers: Record<string, string>, body: FormData = form()) {
  return new Request("https://app.test/api/captures", { method: "POST", headers, body });
}

const fakeStore = () => ({
  limits: async () => ({ textMaxChars: 100, screenshotMaxBytes: 1000 }),
  personExists: async () => true,
  insertCapture: async () => ({ id: "c1", userId: "u1" }),
  uploadScreenshot: async () => {},
  setScreenshotPath: async () => {},
  deleteCapture: async () => {},
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", ID);
  createStore.mockReset();
});

describe("OPTIONS", () => {
  it("answers the extension's preflight", async () => {
    const res = await OPTIONS(
      new Request("https://app.test/api/captures", { method: "OPTIONS", headers: { origin: ORIGIN } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("gives another origin no Allow-Origin", async () => {
    const res = await OPTIONS(
      new Request("https://app.test/api/captures", { method: "OPTIONS", headers: { origin: "https://evil.test" } }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("POST", () => {
  it("gives another origin no Allow-Origin", async () => {
    const res = await POST(post({ origin: "https://evil.test" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("401 without a bearer token", async () => {
    const res = await POST(post({ origin: ORIGIN }));
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("401 when the store rejects the token", async () => {
    createStore.mockResolvedValue(null);
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer bad" }));
    expect(res.status).toBe(401);
    expect(createStore).toHaveBeenCalledWith("bad");
  });

  it("400 for a bad form", async () => {
    createStore.mockResolvedValue(fakeStore());
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer t" }, form({ person_id: "" })));
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("201 with the id on success", async () => {
    createStore.mockResolvedValue(fakeStore());
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer t" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "c1" });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("500 when the extension id is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer t" }));
    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalled();
  });
});
