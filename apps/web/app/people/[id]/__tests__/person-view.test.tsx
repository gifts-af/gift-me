import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getPerson = vi.hoisted(() => vi.fn());
vi.mock("@/modules/concierge", () => ({ getPerson }));
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
    setPhotoAction: action, unlinkListAction: action, updatePersonAction: action,
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
};

async function show(photoFailed = false) {
  render(await PersonView({ id: "p1", photoFailed }));
}

describe("PersonView", () => {
  beforeEach(() => getPerson.mockReset());

  it("is a 404 for a person who is not found", async () => {
    getPerson.mockResolvedValue(null);
    await expect(PersonView({ id: "nope", photoFailed: false })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("shows who they are, where ideas come from, and the sections in order", async () => {
    getPerson.mockResolvedValue(dad);
    await show();
    expect(screen.getByRole("heading", { level: 1, name: "Dad" })).toBeInTheDocument();
    expect(screen.getByText("No list of their own, so we suggest ideas")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Edit", "Occasions", "Your budget", "Link to their list"]);
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
});
