import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appSettingInt = vi.hoisted(() => vi.fn());
const listImportedContactIds = vi.hoisted(() => vi.fn());
vi.mock("@/lib/app-settings", () => ({ appSettingInt }));
vi.mock("@/modules/concierge", () => ({ listImportedContactIds }));
vi.mock("../actions", () => ({ importContactsAction: vi.fn() }));

import { ImportSection } from "../import/import-section";

const connect = () => screen.queryByRole("button", { name: "Connect Google Contacts" });
const googleScripts = () => document.querySelectorAll('script[src*="google"]').length;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "test-client-id");
  vi.spyOn(console, "log").mockImplementation(() => {});
  appSettingInt.mockReset();
  listImportedContactIds.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function expectOff() {
  expect(screen.getByText(/Google import is off for now\./)).toHaveTextContent("Google import is off for now. Add people by hand.");
  expect(screen.getByRole("link", { name: "Add people by hand." })).toHaveAttribute("href", "/people/new");
  expect(connect()).not.toBeInTheDocument();
  expect(googleScripts()).toBe(0);
  expect(listImportedContactIds).not.toHaveBeenCalled();
}

describe("ImportSection (AC-15)", () => {
  it("off: says to add people by hand, and never gets as far as Google", async () => {
    appSettingInt.mockResolvedValue(0);
    render(await ImportSection());
    expect(appSettingInt).toHaveBeenCalledWith("google_import_enabled");
    expectOff();
  });

  it("counts as off when the setting can't be read", async () => {
    appSettingInt.mockRejectedValue(new Error("boom"));
    render(await ImportSection());
    expectOff();
    expect(String(vi.mocked(console.log).mock.calls[0][0])).toContain("google_import_check_failed");
  });

  it("on: offers Connect, and loads nothing from Google until it's pressed", async () => {
    appSettingInt.mockResolvedValue(1);
    render(await ImportSection());
    expect(connect()).toBeInTheDocument();
    expect(screen.queryByText(/Google import is off/)).not.toBeInTheDocument();
    expect(googleScripts()).toBe(0);
  });

  it("on: says so when your imported people can't be loaded", async () => {
    appSettingInt.mockResolvedValue(1);
    listImportedContactIds.mockRejectedValue(new Error("boom"));
    render(await ImportSection());
    expect(screen.getByText("We couldn't load your people. Refresh to try again.")).toBeInTheDocument();
    expect(String(vi.mocked(console.log).mock.calls[0][0])).toContain("imported_contacts_load_failed");
  });

  it("on: says when it isn't set up here", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    appSettingInt.mockResolvedValue(1);
    render(await ImportSection());
    expect(screen.getByRole("alert")).toHaveTextContent("Google import isn't set up here");
  });
});
