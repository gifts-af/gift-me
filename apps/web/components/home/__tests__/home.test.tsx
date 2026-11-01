import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WelcomePage, { metadata } from "@/app/welcome/page";
import { APP_NAME, feedbackHref } from "@/lib/brand";

function link(name: string | RegExp) {
  return screen.getByRole("link", { name });
}

describe("home page (ALL-46)", () => {
  it("leads with the hook, with no alpha banner above it (ALL-50)", () => {
    render(<WelcomePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Gifting, handled AF." })).toBeInTheDocument();
    expect(screen.queryByText(/Lots is broken/)).not.toBeInTheDocument();
  });

  it("offers the tour, access requests and an invite-only way in", () => {
    render(<WelcomePage />);
    expect(link("🔒 Invite only")).toHaveAttribute("href", "/auth/login");
    expect(link("Take the tour")).toHaveAttribute("href", "/tour");
    expect(screen.getAllByRole("link", { name: "Request access" })[0]).toHaveAttribute("href", "/request-access");
    expect(link("Have an invite? Sign in")).toHaveAttribute("href", "/auth/login");
    expect(link("How it works")).toHaveAttribute("href", "#how-it-works");
  });

  it("is honest about what works today", () => {
    render(<WelcomePage />);
    const cards: [string, string][] = [
      ["Your gift list", "Works now"],
      ["Never forget a birthday", "Being built"],
      ["Buy-me-a-drink shirts", "Later"],
    ];
    for (const [title, status] of cards) {
      const card = screen.getByRole("heading", { name: title }).closest("article")!;
      expect(within(card).getByText(status)).toBeInTheDocument();
    }
  });

  it("shows how it'll work, in three steps", () => {
    render(<WelcomePage />);
    const how = document.getElementById("how-it-works")!;
    for (const step of ["Add your people", "We get ideas ready", "You tap yes"]) {
      expect(within(how).getByText(step)).toBeInTheDocument();
    }
    expect(screen.getByText("Nothing is ever bought without your OK.")).toBeInTheDocument();
  });

  it("asks for feedback and credits the builders", () => {
    render(<WelcomePage />);
    expect(link("Send feedback")).toHaveAttribute("href", feedbackHref());
    expect(screen.getByText("GiftsAF alpha · made by Aaron and Jim")).toBeInTheDocument();
  });

  it("sets a title and description for sharing", () => {
    expect(metadata.title).toBe(APP_NAME);
    expect(typeof metadata.description).toBe("string");
    expect(String(metadata.description).length).toBeGreaterThan(0);
  });
});
