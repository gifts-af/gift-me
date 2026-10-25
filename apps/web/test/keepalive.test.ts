// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { keepalive } from "@/lib/keepalive";

const SECRET = "test-secret";
const req = (auth?: string) =>
  new Request("https://example.test/api/keepalive", {
    headers: auth ? { authorization: auth } : {},
  });

describe("keepalive", () => {
  it("rejects a request without the secret and skips the database", async () => {
    const ping = vi.fn();
    const res = await keepalive(req(), { secret: SECRET, ping });
    expect(res.status).toBe(401);
    expect(ping).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const ping = vi.fn();
    const res = await keepalive(req("Bearer nope"), { secret: SECRET, ping });
    expect(res.status).toBe(401);
    expect(ping).not.toHaveBeenCalled();
  });

  it("rejects everything when no secret is configured", async () => {
    const ping = vi.fn();
    const res = await keepalive(req("Bearer "), { secret: undefined, ping });
    expect(res.status).toBe(401);
    expect(ping).not.toHaveBeenCalled();
  });

  it("pings the database with the right secret", async () => {
    const ping = vi.fn().mockResolvedValue(undefined);
    const res = await keepalive(req(`Bearer ${SECRET}`), { secret: SECRET, ping });
    expect(res.status).toBe(200);
    expect(ping).toHaveBeenCalledOnce();
  });

  it("reports a database failure as 500", async () => {
    const ping = vi.fn().mockRejectedValue(new Error("paused"));
    const res = await keepalive(req(`Bearer ${SECRET}`), { secret: SECRET, ping });
    expect(res.status).toBe(500);
  });
});
