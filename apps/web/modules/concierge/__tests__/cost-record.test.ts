// The cost recorder never throws and never holds up the caller. Fake and
// real-builder clients here; the real database is in cost-record-db.test.ts.
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/log", async (orig) => ({ ...(await orig<typeof import("@/lib/log")>()), logEvent: vi.fn() }));
const { logEvent } = await import("@/lib/log");
const { costRecorder } = await import("../costs/record");
type Db = Parameters<typeof costRecorder>[0] extends () => infer D ? D : never;

const cost = { userId: "u-1", kind: "ai_ideas", cents: 12.5, estimated: false, ideaRunId: "run-1" } as const;
const SECRET = "secret message with person@example.com";

/** A fake client: settings come from `setting`, the write goes to `write`. */
function fake(opts: { setting?: unknown; settingError?: boolean; write?: (args: unknown, signal: AbortSignal | undefined) => unknown }) {
  const writes: { args: unknown; signal: AbortSignal | undefined }[] = [];
  const db = {
    schema: () => ({
      rpc: (name: string, args: unknown) => {
        if (name === "setting_int") {
          return Promise.resolve(opts.settingError ? { data: null, error: { message: SECRET, code: "42501" } } : { data: opts.setting ?? null, error: null });
        }
        return {
          abortSignal: (signal: AbortSignal) => {
            writes.push({ args, signal });
            return Promise.resolve(opts.write ? opts.write(args, signal) : { data: null, error: null });
          },
        };
      },
    }),
  };
  return { db: db as unknown as Db, writes };
}

const failed = () => vi.mocked(logEvent).mock.calls.filter((c) => c[0] === "cost.record_failed");

beforeEach(() => vi.mocked(logEvent).mockReset());

describe("costRecorder", () => {
  it("calls record_cost with the cost's fields, using a passed timeout without reading the setting", async () => {
    const f = fake({});
    await costRecorder(() => f.db, 500)(cost);
    expect(f.writes[0].args).toEqual({
      p_user_id: "u-1", p_kind: "ai_ideas", p_cents: 12.5, p_estimated: false, p_idea_run_id: "run-1", p_order_id: undefined,
    });
    expect(failed()).toHaveLength(0);
  });

  it("reads cost_record_timeout_ms only when no timeout is passed", async () => {
    const seen: string[] = [];
    const f = fake({ setting: 2000 });
    const inner = f.db.schema.bind(f.db);
    (f.db as unknown as { schema: unknown }).schema = (s: string) => {
      const r = inner(s as never);
      return { rpc: (name: string, args: unknown) => (seen.push(name), (r as never as { rpc: (n: string, a: unknown) => unknown }).rpc(name, args)) };
    };
    await costRecorder(() => f.db)(cost);
    expect(seen).toEqual(["setting_int", "record_cost"]);
    seen.length = 0;
    await costRecorder(() => f.db, 100)(cost);
    expect(seen).toEqual(["record_cost"]);
  });

  it("logs and doesn't write when the setting is missing or unreadable", async () => {
    for (const f of [fake({ setting: null }), fake({ settingError: true })]) {
      await expect(costRecorder(() => f.db)(cost)).resolves.toBeUndefined();
      expect(f.writes).toHaveLength(0);
    }
    expect(failed().map((c) => (c[1] as { reason: string }).reason)).toEqual(["setting", "setting"]);
  });

  it("logs ids and kind only, omitting undefined ids and never the error message", async () => {
    const f = fake({ write: () => ({ data: null, error: { message: SECRET, code: "P0001" } }) });
    await costRecorder(() => f.db, 100)({ userId: "u-1", kind: "ai_capture", cents: 1, estimated: true });
    expect(failed()).toEqual([["cost.record_failed", { kind: "ai_capture", user_id: "u-1", reason: "write", code: "P0001" }]]);
    expect(JSON.stringify(vi.mocked(logEvent).mock.calls)).not.toContain("secret");
  });

  it("resolves and logs when the client throws, the factory throws, or the write rejects", async () => {
    const throwing = { schema: () => { throw new Error(SECRET); } } as unknown as Db;
    await expect(costRecorder(() => throwing, 100)(cost)).resolves.toBeUndefined();
    await expect(costRecorder(() => { throw new Error(SECRET); }, 100)(cost)).resolves.toBeUndefined();
    const f = fake({ write: () => { throw new Error(SECRET); } });
    await expect(costRecorder(() => f.db, 100)(cost)).resolves.toBeUndefined();
    expect(failed().map((c) => (c[1] as { reason: string }).reason)).toEqual(["write", "client", "write"]);
    expect(JSON.stringify(vi.mocked(logEvent).mock.calls)).not.toContain("secret");
  });

  it("logs the Postgres code of an unreadable setting, never its message", async () => {
    const f = fake({ settingError: true });
    await costRecorder(() => f.db)(cost);
    expect(failed()[0][1]).toMatchObject({ reason: "setting", code: "42501" });
    expect(JSON.stringify(failed())).not.toContain("secret");
  });

  it("resolves even when logEvent itself throws", async () => {
    vi.mocked(logEvent).mockImplementation(() => { throw new Error("stdout closed"); });
    await expect(costRecorder(() => { throw new Error("x"); }, 100)(cost)).resolves.toBeUndefined();
    vi.mocked(logEvent).mockReset();
  });

  it("aborts a write that outlasts the timeout, through a real supabase-js client, and resolves", async () => {
    let aborted = false;
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          rej(new DOMException("aborted", "AbortError"));
        });
      })) as typeof fetch;
    const db = createClient("http://127.0.0.1:1", "key", { global: { fetch: hanging }, auth: { persistSession: false } }) as unknown as Db;
    const started = Date.now();
    await expect(costRecorder(() => db, 50)(cost)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(aborted).toBe(true);
    expect(failed()).toEqual([["cost.record_failed", { kind: "ai_ideas", user_id: "u-1", idea_run_id: "run-1", reason: "write" }]]);
  });
});
