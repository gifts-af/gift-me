import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ALL-167: a person's gifts in progress, read on their own.
const giftsInProgress = vi.hoisted(() => vi.fn());
const setting = vi.hoisted(() => vi.fn(async (...args: unknown[]) => (void args, 14)));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/concierge", () => ({ giftsInProgress }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: setting }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));

import { PersonGifts } from "../person-gifts";

describe("PersonGifts", () => {
  it("lists theirs, by the setting", async () => {
    const line = { text: "Looking for ideas", tone: "muted", needsBuyer: false };
    giftsInProgress.mockResolvedValueOnce([{ roundId: "r1", personId: "p1", personName: "Dad", occasionKind: "birthday", date: "2027-04-01", line }]);
    render(await PersonGifts({ personId: "p1" }));
    expect(screen.getByRole("region", { name: "Gifts in progress" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Birthday gift Looking for ideas" })).toHaveAttribute("href", "/rounds/r1");
    expect(giftsInProgress.mock.calls[0][1]).toMatchObject({ personId: "p1", leaveAfterDays: 14 });
    expect(setting.mock.calls[0][0]).toBe("gift_progress_days");
  });

  it.each([
    ["the read fails", () => giftsInProgress.mockRejectedValueOnce(new Error("boom"))],
    ["the setting is missing", () => setting.mockRejectedValueOnce(new Error("Setting gift_progress_days is missing."))],
  ])("shows nothing and logs ids when %s", async (_what, set) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    set();
    expect(await PersonGifts({ personId: "p1" })).toBeNull();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: "gifts_in_progress_failed", user_id: "u1", person_id: "p1" });
    log.mockRestore();
  });

  it("shows nothing when there are none", async () => {
    giftsInProgress.mockResolvedValueOnce([]);
    expect(await PersonGifts({ personId: "p1" })).toBeNull();
  });
});
