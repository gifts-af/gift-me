import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const giftsInProgress = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/modules/concierge", () => ({ giftsInProgress }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 14 }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));

import { GiftsList } from "../gifts-list";

const gift = (roundId: string, over: object = {}) => ({
  roundId,
  personId: "p1",
  personName: "Jenn",
  occasionKind: "christmas" as const,
  date: "2026-12-16",
  line: { text: "3 ideas ready · Choose by Tue, Dec 15", tone: "ready" as const, needsBuyer: true },
  ...over,
});

// Braces: a function returned from beforeEach is run as its teardown.
beforeEach(() => {
  giftsInProgress.mockReset();
});

describe("GiftsList, the gifts page", () => {
  it("lists every gift as a link, in the order given, with the person, occasion and status in words (AC-3)", async () => {
    giftsInProgress.mockResolvedValue([
      gift("r1"),
      gift("r2", { personName: "Uncle Bob", line: { text: "Needs an address", tone: "warn", needsBuyer: true } }),
      gift("r3", { personName: "Mom", occasionKind: null, line: { text: "Ordered", tone: "muted", needsBuyer: false } }),
    ]);
    render(await GiftsList());
    const links = within(screen.getByRole("list")).getAllByRole("link");
    expect(links.map((l) => [l.getAttribute("href"), l.textContent])).toEqual([
      ["/rounds/r1", "Jenn · Christmas 3 ideas ready · Choose by Tue, Dec 15"],
      ["/rounds/r2", "Uncle Bob · Christmas Needs an address"],
      ["/rounds/r3", "Mom · Gift Ordered"],
    ]);
    for (const link of links) expect(link).toHaveClass("min-h-11");
    expect(screen.getByText("Needs an address")).toHaveClass("text-warning");
    // Every person's gifts, not one person's.
    expect(giftsInProgress.mock.calls[0][1].personId).toBeUndefined();
  });

  it("says so when there are none", async () => {
    giftsInProgress.mockResolvedValue([]);
    render(await GiftsList());
    expect(screen.getByText("No gifts in progress.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says it couldn't load them when the read fails, never that there are none", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    giftsInProgress.mockRejectedValue(new Error("boom"));
    render(await GiftsList());
    expect(screen.getByText("Couldn't load your gifts. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("No gifts in progress.")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    log.mockRestore();
  });
});
