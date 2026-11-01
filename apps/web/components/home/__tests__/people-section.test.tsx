import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const listPeople = vi.hoisted(() => vi.fn());
vi.mock("@/modules/concierge", () => ({ listPeople }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));

import { PeopleSection } from "../people-section";

afterEach(() => vi.restoreAllMocks());

describe("PeopleSection", () => {
  it("shows a quiet one-line message when people can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listPeople.mockRejectedValue(new Error("boom"));
    render(await PeopleSection());
    expect(screen.getByText("We couldn't load your people. Refresh to try again.")).toBeInTheDocument();
  });

  it("invites you to add someone when there is no one", async () => {
    listPeople.mockResolvedValue([]);
    render(await PeopleSection());
    expect(screen.getByRole("link", { name: "Add someone you buy for" })).toBeInTheDocument();
  });
});
