// @vitest-environment node
// The close route (ALL-127): a tab going away with a remove held for Undo posts
// the ids here with fetch keepalive. It checks who and where the request is
// from, takes only { listId, version, removeIds }, and saves through the
// checked path. That path against the real database is
// modules/lists/__tests__/save-list.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const removeGifts = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims } }) }));
vi.mock("@/modules/lists", () => ({ removeGifts: (...args: unknown[]) => removeGifts(...args) }));

const { POST } = await import("../route");

const LIST = "11111111-1111-4111-8111-111111111111";
const GIFT = "22222222-2222-4222-8222-222222222222";
const VERSION = "2026-11-16 17:00:00.123456+00";
const body = { listId: LIST, version: VERSION, removeIds: [GIFT] };

function post(
  data: unknown = body,
  headers: Record<string, string> = { origin: "https://giftsaf.test", host: "giftsaf.test", "content-type": "application/json" },
) {
  return new Request("https://giftsaf.test/api/lists/save-on-close", {
    method: "POST",
    headers,
    body: typeof data === "string" ? data : JSON.stringify(data),
  });
}

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "user-1" } } });
  removeGifts.mockReset().mockResolvedValue({ outcome: "saved", behind: false });
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("POST /api/lists/save-on-close", () => {
  it("removes the named gifts for the signed-in user and logs it by id", async () => {
    const res = await POST(post());
    expect(res.status).toBe(204);
    expect(removeGifts).toHaveBeenCalledWith(expect.anything(), "user-1", body);
    const event = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(event).toEqual({
      event: "list_close_sent",
      at: expect.any(String),
      user_id: "user-1",
      list_id: LIST,
      removed: 1,
      behind: false,
      outcome: "saved",
    });
  });

  it("refuses a signed-out request", async () => {
    getClaims.mockResolvedValue({ data: null });
    expect((await POST(post())).status).toBe(401);
    expect(removeGifts).not.toHaveBeenCalled();
  });

  it("refuses another origin, or none", async () => {
    const other = await POST(post(body, { origin: "https://evil.test", host: "giftsaf.test", "content-type": "application/json" }));
    expect(other.status).toBe(403);
    const none = await POST(post(body, { host: "giftsaf.test", "content-type": "application/json" }));
    expect(none.status).toBe(403);
    expect(removeGifts).not.toHaveBeenCalled();
  });

  it("refuses anything but JSON", async () => {
    const res = await POST(post(body, { origin: "https://giftsaf.test", host: "giftsaf.test", "content-type": "text/plain" }));
    expect(res.status).toBe(415);
    expect(removeGifts).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON at all", "{nope"],
    ["a missing field", { listId: LIST, version: VERSION }],
    ["an extra field", { ...body, items: [] }],
    ["a list id that isn't a uuid", { ...body, listId: "list-1" }],
    ["a gift id that isn't a uuid", { ...body, removeIds: ["x"] }],
    ["no gift ids", { ...body, removeIds: [] }],
    ["a version that isn't a string", { ...body, version: 1 }],
    ["a far too long version", { ...body, version: "x".repeat(65) }],
  ])("refuses %s", async (_, data) => {
    expect((await POST(post(data))).status).toBe(400);
    expect(removeGifts).not.toHaveBeenCalled();
  });

  it("says when the list wasn't found or the save didn't land", async () => {
    removeGifts.mockResolvedValueOnce({ outcome: "not_found", behind: false });
    expect((await POST(post())).status).toBe(404);
    removeGifts.mockResolvedValueOnce({ outcome: "stale", behind: true });
    expect((await POST(post())).status).toBe(409);
    removeGifts.mockResolvedValueOnce({ outcome: "error", behind: false });
    expect((await POST(post())).status).toBe(500);
  });
});
