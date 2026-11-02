// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createStore, processCapture, CaptureNotFound } = vi.hoisted(() => ({
  createStore: vi.fn(),
  processCapture: vi.fn(),
  CaptureNotFound: class CaptureNotFound extends Error {},
}));
vi.mock("@/modules/concierge", () => ({
  CaptureNotFound,
  createSupabaseCaptureStore: (token: string) => createStore(token),
  processCapture: (...args: unknown[]) => processCapture(...args),
}));

import { OPTIONS, POST } from "../route";

const ID = "abcdefghijklmnop";
const ORIGIN = `chrome-extension://${ID}`;
const ctx = { params: Promise.resolve({ id: "cap-1" }) };

function post(headers: Record<string, string>) {
  return new Request("https://app.test/api/captures/cap-1/extract", { method: "POST", headers });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", ID);
  createStore.mockReset();
  processCapture.mockReset();
});

describe("OPTIONS", () => {
  it("answers the extension's preflight", async () => {
    const res = await OPTIONS(
      new Request("https://app.test/api/captures/cap-1/extract", { method: "OPTIONS", headers: { origin: ORIGIN } }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });
});

describe("POST", () => {
  it("401 without a bearer token", async () => {
    const res = await POST(post({ origin: ORIGIN }), ctx);
    expect(res.status).toBe(401);
  });

  it("401 when the store rejects the token", async () => {
    createStore.mockResolvedValue(null);
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer bad" }), ctx);
    expect(res.status).toBe(401);
  });

  it("404 for an unknown or someone else's capture", async () => {
    createStore.mockResolvedValue({});
    processCapture.mockRejectedValue(new CaptureNotFound());
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer t" }), ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("200 with what was learned", async () => {
    const store = {};
    createStore.mockResolvedValue(store);
    const extraction = { status: "extracted", facts: [{ id: "f1", category: "owns", value: "kettle" }] };
    processCapture.mockResolvedValue(extraction);
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer t" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ extraction });
    expect(processCapture).toHaveBeenCalledWith(store, expect.any(Function), "cap-1");
  });

  it("500 when something else goes wrong", async () => {
    createStore.mockResolvedValue({});
    processCapture.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer t" }), ctx);
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});
