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
const CAPTURE = "9fba3c37-5b25-4274-b1ed-eab8c50d5327";
const ctx = { params: Promise.resolve({ id: CAPTURE }) };

function post(headers: Record<string, string>) {
  return new Request(`https://app.test/api/captures/${CAPTURE}/extract`, { method: "POST", headers });
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
    expect(processCapture).toHaveBeenCalledWith(store, expect.any(Function), CAPTURE);
  });

  it("404 for an id that isn't a capture id, without reading anything", async () => {
    createStore.mockResolvedValue({});
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer t" }), { params: Promise.resolve({ id: "not-an-id" }) });
    expect(res.status).toBe(404);
    expect(processCapture).not.toHaveBeenCalled();
  });

  it("500 when something else goes wrong, logging ids and the error type only (E6)", async () => {
    createStore.mockResolvedValue({});
    processCapture.mockRejectedValue(new Error("page said: Dad's surprise party"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({ origin: ORIGIN, authorization: "Bearer t" }), ctx);
    expect(res.status).toBe(500);
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ event: "capture.retry_failed", capture_id: CAPTURE, error: "Error" });
    expect(log.mock.calls[0][0]).not.toContain("surprise");
    log.mockRestore();
    error.mockRestore();
  });
});
