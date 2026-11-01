import { beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeChrome, type FakeChrome } from "../../test/fake-chrome";

vi.mock("../config", () => ({
  config: { appOrigin: "https://app.test", supabaseUrl: "https://sb.test", supabaseKey: "key", jpegQuality: 0.8 },
}));

const verifyOtp = vi.fn();
const authSignOut = vi.fn();
const createClient = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: (...a: unknown[]) => createClient(...a) }));

let fake: FakeChrome;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  createClient.mockReturnValue({ auth: { verifyOtp, signOut: authSignOut } });
  fake = installFakeChrome();
});

describe("chromeStorage", () => {
  it("round-trips through chrome.storage.local", async () => {
    const { chromeStorage } = await import("../storage");
    expect(await chromeStorage.getItem("k")).toBeNull();
    await chromeStorage.setItem("k", "v");
    expect(fake.storage.local.data.get("k")).toBe("v");
    expect(await chromeStorage.getItem("k")).toBe("v");
    await chromeStorage.removeItem("k");
    expect(await chromeStorage.getItem("k")).toBeNull();
  });
});

describe("getSupabase", () => {
  it("creates one client with chrome storage and persistent session", async () => {
    const { getSupabase } = await import("../supabase");
    const { chromeStorage } = await import("../storage");
    expect(getSupabase()).toBe(getSupabase());
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith("https://sb.test", "key", {
      auth: { storage: chromeStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  });
});

describe("connect", () => {
  it("verifies the token hash as a magiclink", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { connect } = await import("../auth");
    expect(await connect("abc")).toEqual({ ok: true });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "magiclink" });
  });

  it("maps an error to a plain sentence without provider text", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "secret provider detail" } });
    const { connect } = await import("../auth");
    const result = await connect("abc");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret provider detail");
  });

  it("maps a thrown error too", async () => {
    verifyOtp.mockRejectedValue(new Error("network down"));
    const { connect } = await import("../auth");
    expect(await connect("abc")).toMatchObject({ ok: false });
  });
});

describe("signOut", () => {
  it("signs out with local scope", async () => {
    authSignOut.mockResolvedValue({ error: null });
    const { signOut } = await import("../auth");
    await signOut();
    expect(authSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("swallows network errors", async () => {
    authSignOut.mockRejectedValue(new Error("offline"));
    const { signOut } = await import("../auth");
    await expect(signOut()).resolves.toBeUndefined();
  });
});

describe("background", () => {
  async function setup() {
    const connect = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("../auth", () => ({ connect }));
    await import("../../background");
    const listener = fake.runtime.onMessageExternal.listeners[0];
    return { connect, listener };
  }
  const good = { type: "connect", tokenHash: "h" };
  const from = { url: "https://app.test/extension/connect" };

  it("registers a listener and accepts a valid message", async () => {
    const { connect, listener } = await setup();
    const reply = vi.fn();
    expect(listener(good, from, reply)).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: true }));
    expect(connect).toHaveBeenCalledWith("h");
  });

  it("uses sender.origin when present", async () => {
    const { connect, listener } = await setup();
    listener(good, { origin: "https://app.test" }, vi.fn());
    expect(connect).toHaveBeenCalledWith("h");
  });

  it.each([
    ["wrong origin", good, { url: "https://evil.test/x" }],
    ["subdomain lookalike", good, { url: "https://app.test.evil.test/x" }],
    ["no sender url", good, {}],
    ["wrong type", { type: "other", tokenHash: "h" }, from],
    ["missing tokenHash", { type: "connect" }, from],
    ["empty tokenHash", { type: "connect", tokenHash: "" }, from],
    ["non-string tokenHash", { type: "connect", tokenHash: 5 }, from],
    ["non-object", "connect", from],
    ["null", null, from],
  ])("rejects %s", async (_n, message, sender) => {
    const { connect, listener } = await setup();
    const reply = vi.fn();
    expect(listener(message, sender, reply)).toBe(false);
    expect(reply).toHaveBeenCalledWith({ ok: false, error: "Not allowed." });
    expect(connect).not.toHaveBeenCalled();
  });
});
