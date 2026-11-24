import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const giftsInProgress = vi.hoisted(() => vi.fn());
const sub = vi.hoisted(() => ({ value: "u1" as string | undefined }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/concierge", () => ({ giftsInProgress }));
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

beforeEach(() => {
  giftsInProgress.mockReset();
  sub.value = "u1";
});

describe("GiftsSection", () => {
  it("is a list of links, in the order given, with the person, occasion and status in words", async () => {
    giftsInProgress.mockResolvedValue([
      gift("r1"),
      gift("r2", { personName: "Uncle Bob", line: { text: "Needs an address", tone: "warn", needsBuyer: true } }),
      gift("r3", { personName: "Mom", occasionKind: null, line: { text: "Ordered", tone: "muted", needsBuyer: false } }),
    ]);
    render(await GiftsSection());
    const region = screen.getByRole("region", { name: "Gifts in progress" });
    expect(within(region).getByRole("heading", { level: 2, name: "Gifts in progress" })).toBeInTheDocument();
    const links = within(region).getAllByRole("link");
    expect(links.map((l) => [l.getAttribute("href"), l.textContent])).toEqual([
      ["/rounds/r1", "Jenn · Christmas 3 ideas ready · Choose by Tue, Dec 15"],
      ["/rounds/r2", "Uncle Bob · Christmas Needs an address"],
      ["/rounds/r3", "Mom · Gift Ordered"],
    ]);
    for (const link of links) expect(link).toHaveClass("min-h-11");
    expect(screen.getByText("Needs an address")).toHaveClass("text-warning");
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
