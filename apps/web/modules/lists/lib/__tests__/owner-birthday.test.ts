import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const logEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ schema: () => ({ rpc }) }) }));
vi.mock("@/lib/log", () => ({ logEvent, errorFields: () => ({}) }));

import { getOwnerBirthday } from "../lists";

const TOKEN = "11111111-1111-4111-8111-111111111111";

// Who may read it is in account_birthdays.test.sql.
describe("getOwnerBirthday (ALL-182 AC-5, AC-6)", () => {
  beforeEach(() => {
    rpc.mockReset();
    logEvent.mockReset();
  });

  it("gives the month and day", async () => {
    rpc.mockResolvedValue({ data: { month: 3, day: 14 }, error: null });
    expect(await getOwnerBirthday(TOKEN)).toEqual({ month: 3, day: 14 });
    expect(rpc).toHaveBeenCalledWith("owner_birthday", { p_token: TOKEN });
  });

  it("gives none when there's none, and doesn't ask with a malformed token", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await getOwnerBirthday(TOKEN)).toBeNull();
    rpc.mockClear();
    expect(await getOwnerBirthday("nope")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gives none for an answer that isn't a month and day", async () => {
    for (const data of [{}, { month: "3", day: 14 }, [3, 14]]) {
      rpc.mockResolvedValue({ data, error: null });
      expect(await getOwnerBirthday(TOKEN)).toBeNull();
    }
  });

  it("gives none when the read fails, and logs the code without the token", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: TOKEN } });
    expect(await getOwnerBirthday(TOKEN)).toBeNull();
    expect(logEvent).toHaveBeenCalledWith("lists.owner_birthday_failed", { code: "42501" });
  });
});
