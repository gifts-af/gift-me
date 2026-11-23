import { describe, expect, it, vi } from "vitest";

// The test clock comes from the tick, which imports the server-only concierge module.
vi.mock("server-only", () => ({}));
const { handleHealth } = await import("../health");

const SECRET = "s3cret";
const tell = async () => true;
const req = (auth?: string, query = "") =>
  new Request(`https://example.test/api/health${query}`, { headers: auth ? { authorization: auth } : {} });

describe("handleHealth", () => {
  it.each([
    ["no header", undefined, SECRET],
    ["a wrong secret", "Bearer nope", SECRET],
    ["an unset secret", "Bearer undefined", undefined],
  ])("AC-13: 401 with %s, and run isn't called", async (_n, auth, cronSecret) => {
    const run = vi.fn();
    const tellOwner = vi.fn();
    const res = await handleHealth(req(auth), { cronSecret }, run, tellOwner);
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    expect(tellOwner).not.toHaveBeenCalled();
  });

  it("?now= is used off production and ignored on production", async () => {
    const run = vi.fn().mockResolvedValue({ result: "quiet", problems: 0 });
    await handleHealth(req(`Bearer ${SECRET}`, "?now=2027-03-20T14:00:00Z"), { cronSecret: SECRET, vercelEnv: "preview" }, run, tell);
    expect(run).toHaveBeenLastCalledWith(new Date("2027-03-20T14:00:00Z"));

    const before = Date.now();
    await handleHealth(req(`Bearer ${SECRET}`, "?now=2027-03-20T14:00:00Z"), { cronSecret: SECRET, vercelEnv: "production" }, run, tell);
    const used = (run.mock.lastCall![0] as Date).getTime();
    expect(used).toBeGreaterThanOrEqual(before);
    expect(used).toBeLessThanOrEqual(Date.now());
  });

  it("200 with the result when the check went through, 500 when it didn't or threw", async () => {
    const ok = await handleHealth(req(`Bearer ${SECRET}`), { cronSecret: SECRET }, async () => ({ result: "sent", problems: 2 }), tell);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, result: "sent", problems: 2 });
    expect((await handleHealth(req(`Bearer ${SECRET}`), { cronSecret: SECRET }, async () => ({ result: "off", problems: 0 }), tell)).status).toBe(200);

    for (const result of ["db_down", "send_failed", "failed"]) {
      const res = await handleHealth(req(`Bearer ${SECRET}`), { cronSecret: SECRET }, async () => ({ result, problems: 1 }), tell);
      expect(res.status).toBe(500);
    }
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const tellOwner = vi.fn(async () => true);
    const thrown = await handleHealth(
      req(`Bearer ${SECRET}`),
      { cronSecret: SECRET },
      async () => {
        throw new Error("no admin key");
      },
      tellOwner,
    );
    expect(thrown.status).toBe(500);
    expect(await thrown.json()).toEqual({ ok: false });
    expect(tellOwner).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: "health.checked", result: "failed", stage: "wiring", sent: true, alert: true });
    log.mockRestore();
  });

  it("wiring that throws while the owner email fails too still answers 500 and logs sent false", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await handleHealth(
      req(`Bearer ${SECRET}`),
      { cronSecret: SECRET },
      async () => {
        throw new Error("no admin key");
      },
      async () => {
        throw new Error("no resend key");
      },
    );
    expect(res.status).toBe(500);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: "health.checked", stage: "wiring", sent: false });
    log.mockRestore();
  });
});
