import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getPerson = vi.hoisted(() => vi.fn());
const getProfile = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ groups: [], off: [], unread: 0, openCount: 0, readiness: null as unknown })),
);
vi.mock("@/modules/concierge", () => ({ getPerson, getProfile }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));
vi.mock("@/lib/app-settings", () => ({ appSettingInt: async () => 1000 }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } } }) } }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("../../actions", () => {
  const action = async () => ({ ok: true });
  return {
    deletePersonAction: action, linkListAction: action, setBudgetAction: action, setOccasionEnabledAction: action,
    setPhotoAction: action, unlinkListAction: action, updatePersonAction: action, editFactAction: action, setFactActiveAction: action, deleteFactAction: action,
    readCapturesAction: action, saveAddressAction: action, removeAddressAction: action,
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

async function show(photoFailed = false, openAddress = false) {
  return render(await PersonView({ id: "p1", photoFailed, openAddress }));
}

describe("PersonView", () => {
  beforeEach(() => getPerson.mockReset());

  it("is a 404 for a person who is not found", async () => {
    getPerson.mockResolvedValue(null);
    await expect(PersonView({ id: "nope", photoFailed: false, openAddress: false })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("shows who they are, where ideas come from, and the sections in order", async () => {
    getPerson.mockResolvedValue(dad);
    await show();
    expect(screen.getByRole("heading", { level: 1, name: "Dad" })).toBeInTheDocument();
    expect(screen.getByText("No list of their own, so we suggest ideas")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["What we know", "Edit", "Occasions", "Your budget", "Shipping address", "Link to their list"]);
    expect(getProfile.mock.calls[0].slice(1)).toEqual(["p1", false]);
    expect(screen.getByRole("button", { name: "Delete Dad" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says Their own list for someone who keeps one", async () => {
    getPerson.mockResolvedValue({ ...dad, keepsList: true });
    await show();
    expect(screen.getByText("Their own list")).toBeInTheDocument();
  });

  it("notes a photo that failed to save", async () => {
    getPerson.mockResolvedValue(dad);
    await show(true);
    expect(screen.getByRole("status")).toHaveTextContent("The photo didn't save. Try again.");
  });

  it("opens the address form when asked to by the address email (ALL-81 AC-8)", async () => {
    getPerson.mockResolvedValue(dad);
    await show(false, true);
    expect(screen.getByLabelText("Street address")).toBeInTheDocument();
  });

  it("keeps the address form closed otherwise (AC-1, AC-9)", async () => {
    getPerson.mockResolvedValue(dad);
    await show();
    expect(screen.queryByLabelText("Street address")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add an address" })).toBeInTheDocument();
  });

  it("never puts a shared address's street in the page (AC-12)", async () => {
    getPerson.mockResolvedValue({ ...dad, keepsList: true, address: { kind: "shared", city: "Tampa", state: "FL" } });
    const { container } = await show(false, true);
    expect(screen.getByText("Gifts ship to Dad's own address in Tampa, FL. They keep it up to date.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Street address")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/Oak|line1/);
  });
});
