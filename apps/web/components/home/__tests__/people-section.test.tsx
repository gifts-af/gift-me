import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const listPeople = vi.hoisted(() => vi.fn());
vi.mock("@/modules/concierge", () => ({ listPeople }));
const appSettingInt = vi.hoisted(() => vi.fn(async (key: string) => (key === "google_import_enabled" ? 1 : 0)));
vi.mock("@/lib/app-settings", () => ({ appSettingInt }));
vi.mock("@/lib/today", () => ({ todayForRequest: async () => "2026-11-01" }));

import { PeopleSection } from "../people-section";

afterEach(() => {
  vi.restoreAllMocks();
  appSettingInt.mockImplementation(async (key) => (key === "google_import_enabled" ? 1 : 0));
});

describe("PeopleSection", () => {
  it("shows a quiet one-line message when people can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listPeople.mockRejectedValue(new Error("boom"));
    render(await PeopleSection());
    expect(screen.getByText("We couldn't load your people. Refresh to try again.")).toBeInTheDocument();
  });

  it("doesn't offer Google import when it's off (AC-15)", async () => {
    appSettingInt.mockResolvedValue(0);
    listPeople.mockResolvedValue([]);
    render(await PeopleSection());
    expect(screen.getByRole("link", { name: "Add someone you buy for" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import from Google" })).not.toBeInTheDocument();
  });

  it("counts Google import as off when its setting can't be read (AC-15)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    appSettingInt.mockRejectedValue(new Error("secret detail"));
    listPeople.mockResolvedValue([]);
    render(await PeopleSection());
    expect(screen.getByRole("link", { name: "Add someone you buy for" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import from Google" })).not.toBeInTheDocument();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ event: "google_import_check_failed" });
    expect(String(log.mock.calls[0][0])).not.toContain("secret detail");
  });

  it("invites you to add someone when there is no one", async () => {
    listPeople.mockResolvedValue([]);
    render(await PeopleSection());
    expect(screen.getByText("Add the people you buy for, and keep their lists in one place.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add someone you buy for" })).toBeInTheDocument();
  });

  // ALL-24: Google import sits next to adding by hand, empty or not.
  it.each([[[]], [[{ id: "p1", name: "Mom", relationship: "mother", photoUrl: null, next: null, keepsList: false, hasBirthday: false }]]])(
    "offers Import from Google next to Add (%#)",
    async (people) => {
      listPeople.mockResolvedValue(people);
      render(await PeopleSection());
      expect(screen.getByRole("link", { name: "Import from Google" })).toHaveAttribute("href", "/people/import");
    },
  );
});
