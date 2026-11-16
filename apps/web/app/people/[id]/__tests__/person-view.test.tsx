import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getPerson = vi.hoisted(() => vi.fn());
const getProfile = vi.hoisted(() =>
  vi.fn(async (...args: unknown[]) => (void args, { groups: [], off: [], unread: 0, openCount: 0, readiness: null as unknown })),
);
const listSavedGifts = vi.hoisted(() => vi.fn(async (...args: unknown[]) => (void args, [] as unknown[])));
vi.mock("@/modules/concierge", () => ({ getPerson, getProfile, listSavedGifts }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));
vi.mock("../../actions", () => {
  const action = async () => ({ ok: true });
  return {
    deletePersonAction: action, setOccasionEnabledAction: action, editFactAction: action, setFactActiveAction: action,
    deleteFactAction: action, readCapturesAction: action, confirmFactAction: action,
  };
});
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({
  notFound,
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { PersonView } from "../person-view";

const dad = {
  id: "p1", name: "Dad", relationship: "father", photoUrl: null, photoPath: null, keepsList: false, hasBirthday: true,
  next: { kind: "birthday", date: "2027-04-10" }, birthYear: null, birthday: { month: 4, day: 10 }, anniversary: null,
  occasions: [
    { kind: "birthday", enabled: true, date: "2027-04-10", orderBy: { date: "2027-04-01", fast: false }, budgetCents: null },
  ],
  address: { kind: "none" },
};

async function show(photoFailed = false) {
  return render(await PersonView({ id: "p1", photoFailed }));
}

describe("PersonView", () => {
  beforeEach(() => getPerson.mockReset());

  it("is a 404 for a person who is not found", async () => {
    getPerson.mockResolvedValue(null);
    await expect(PersonView({ id: "nope", photoFailed: false })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  // ALL-127 AC-1: what we know, then rows for who they are, occasions and gifts.
  it("shows who they are, what we know, then rows, with no forms", async () => {
    getPerson.mockResolvedValue(dad);
    await show();
    expect(screen.getByRole("heading", { level: 1, name: "Dad" })).toBeInTheDocument();
    expect(screen.getByText("No list of their own, so we suggest ideas")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["What we know", "Occasions", "Gifts"]);
    expect(getProfile.mock.calls[0].slice(1)).toEqual(["p1", false]);
    expect(screen.getByRole("switch", { name: "Birthday" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Delete Dad" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // The Edit form and the inline sections are gone.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add an address" })).toBeNull();
    expect(screen.queryByRole("button", { name: /photo/i })).toBeNull();
  });

  it("has an About row with the relationship and birthday, opening About", async () => {
    getPerson.mockResolvedValue(dad);
    await show();
    const about = screen.getByRole("link", { name: /^About Dad/ });
    expect(about).toHaveAttribute("href", "/people/p1/about");
    expect(about).toHaveTextContent("Father · Birthday Apr 10");
  });

  it("leaves the birthday out of the About row when there isn't one", async () => {
    getPerson.mockResolvedValue({ ...dad, birthday: null });
    await show();
    expect(screen.getByRole("link", { name: /^About Dad/ })).toHaveTextContent(/Father$/);
  });

  it("has the gift rows, each opening its own screen", async () => {
    getPerson.mockResolvedValue(dad);
    await show();
    const row = (name: RegExp) => screen.getByRole("link", { name });
    expect(row(/^Budget/)).toHaveAttribute("href", "/people/p1/budget");
    expect(row(/^Saved gifts/)).toHaveAttribute("href", "/people/p1/saved-gifts");
    expect(row(/^Saved gifts/)).toHaveTextContent("None");
    expect(row(/^Their list/)).toHaveAttribute("href", "/people/p1/list");
    expect(row(/^Their list/)).toHaveTextContent("Not linked");
    expect(row(/^Shipping address/)).toHaveAttribute("href", "/people/p1/address");
    expect(row(/^Shipping address/)).toHaveTextContent("Not added");
  });

  it("counts saved gifts, and says Linked for someone with a list", async () => {
    getPerson.mockResolvedValue({ ...dad, keepsList: true });
    listSavedGifts.mockResolvedValueOnce([{ id: "g1" }, { id: "g2" }]);
    await show();
    expect(screen.getByText("Their own list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Saved gifts/ })).toHaveTextContent("2");
    expect(screen.getByRole("link", { name: /^Their list/ })).toHaveTextContent("Linked");
  });

  it("sums up the address: the street, or what's missing", async () => {
    const own = (problems: Record<string, string>) => ({
      kind: "own",
      address: { firstName: "Dad", lastName: "A", line1: "12 Oak Lane", line2: null, city: "Tampa", state: "FL", zip: "33602" },
      problems,
    });
    getPerson.mockResolvedValue({ ...dad, address: own({}) });
    const { unmount } = await show();
    expect(screen.getByRole("link", { name: /^Shipping address/ })).toHaveTextContent("12 Oak Lane");
    unmount();
    getPerson.mockResolvedValue({ ...dad, address: own({ zip: "Enter a 5-digit ZIP code." }) });
    await show();
    expect(screen.getByRole("link", { name: /^Shipping address/ })).toHaveTextContent("Something's missing");
  });

  it("never puts a shared address's street in the page (ALL-81 AC-12)", async () => {
    getPerson.mockResolvedValue({ ...dad, keepsList: true, address: { kind: "shared", city: "Tampa", state: "FL" } });
    const { container } = await show();
    expect(screen.getByRole("link", { name: /^Shipping address/ })).toHaveTextContent("Tampa, FL");
    expect(container.innerHTML).not.toMatch(/Oak|line1/);
  });

  it("notes a photo that failed to save", async () => {
    getPerson.mockResolvedValue(dad);
    await show(true);
    expect(screen.getByRole("status")).toHaveTextContent("The photo didn't save. Try again.");
  });
});
