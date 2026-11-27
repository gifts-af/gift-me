import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const giftsInProgress = vi.hoisted(() => vi.fn());
const sub = vi.hoisted(() => ({ value: "u1" as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/concierge", () => ({ giftsInProgress }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 14 }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: sub.value } } }) } }),
}));

import { GiftsInProgress } from "@/components/gifts-in-progress";
import { GiftsSection } from "../gifts-section";

const gift = (roundId: string, over: object = {}) => ({
  roundId,
  personId: "p1",
  personName: "Jenn",
  occasionKind: "christmas" as const,
  date: "2026-12-16",
  line: { text: "3 ideas ready · Choose by Tue, Dec 15", tone: "ready" as const, needsBuyer: true },
  ...over,
});
const fix = { text: "Needs a fix · Choose by Tue, Dec 15", tone: "warn", needsBuyer: true };
const noIdeas = { text: "No ideas found yet", tone: "warn", needsBuyer: false };
const ordered = { text: "Ordered", tone: "muted", needsBuyer: false };

beforeEach(() => {
  giftsInProgress.mockReset();
  sub.value = "u1";
});

describe("GiftsSection", () => {
  it("is one row with the count and how many need you, in amber, opening the gifts page (AC-1)", async () => {
    giftsInProgress.mockResolvedValue([
      gift("r1"),
      gift("r2", { line: fix }),
      gift("r3", { line: noIdeas }),
      gift("r4", { line: ordered }),
    ]);
    render(await GiftsSection());
    const region = screen.getByRole("region", { name: "Gifts in progress" });
    const links = within(region).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/gifts");
    expect(links[0]).toHaveTextContent(/^Gifts in progress4 · 2 need you$/);
    expect(links[0]).toHaveClass("min-h-11");
    expect(within(region).getByText("2 need you")).toHaveClass("text-warning");
    // No round is listed here any more.
    expect(within(region).queryByText(/Jenn/)).toBeNull();
  });

  it("says one needs you", async () => {
    giftsInProgress.mockResolvedValue([gift("r1"), gift("r2", { line: ordered })]);
    render(await GiftsSection());
    expect(screen.getByRole("link")).toHaveTextContent(/^Gifts in progress2 · 1 needs you$/);
  });

  it("is just the count when none need you", async () => {
    giftsInProgress.mockResolvedValue([gift("r1", { line: noIdeas }), gift("r2", { line: ordered })]);
    render(await GiftsSection());
    expect(screen.getByRole("link")).toHaveTextContent(/^Gifts in progress2$/);
    expect(screen.queryByText(/need/)).toBeNull();
  });

  it.each([
    ["there are none", () => giftsInProgress.mockResolvedValue([])],
    ["nobody is signed in", () => (sub.value = undefined)],
  ])("shows nothing when %s", async (_what, set) => {
    set();
    expect(await GiftsSection()).toBeNull();
  });

  it("shows nothing and logs ids only when the read fails", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    giftsInProgress.mockRejectedValue(new Error("no row for jordan@example.com"));
    expect(await GiftsSection()).toBeNull();
    expect(log).toHaveBeenCalledOnce();
    const logged = String(log.mock.calls[0][0]);
    expect(JSON.parse(logged)).toMatchObject({ event: "gifts_in_progress_failed", user_id: "u1", name: "Error" });
    expect(logged).not.toContain("jordan");
    log.mockRestore();
  });
});

describe("GiftsInProgress on a person's page", () => {
  it("names the occasion's gift, not the person", () => {
    render(<GiftsInProgress gifts={[gift("r1"), gift("r2", { occasionKind: null })]} withPerson={false} />);
    expect(screen.getByText("Christmas gift")).toBeInTheDocument();
    expect(screen.getByText("Gift")).toBeInTheDocument();
    expect(screen.queryByText(/Jenn/)).toBeNull();
  });
});
