import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WelcomePage, { metadata } from "@/app/welcome/page";
import { APP_NAME } from "@/lib/brand";

function link(name: string | RegExp) {
  return screen.getByRole("link", { name });
}

describe("home page (ALL-46)", () => {
  // ALL-71: the list (works today) leads; the concierge hook follows.
  const listHero = () => screen.getByRole("heading", { level: 1 }).closest("section")!;
  const conciergeHero = () => screen.getByRole("heading", { level: 2, name: "Gifting, handled AF." }).closest("section")!;

  it("leads with the list hero, with no alpha banner above it (ALL-50, ALL-71)", () => {
    render(<WelcomePage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Your wish list, one text away.");
    expect(listHero().nextElementSibling).toBe(conciergeHero());
    expect(screen.queryByText(/Lots is broken/)).not.toBeInTheDocument();
  });

  it("the list hero offers its own tour and Request access (ALL-71)", () => {
    render(<WelcomePage />);
    const hero = within(listHero());
    expect(hero.getByText(/What do you want for your birthday\?/)).toBeInTheDocument();
    expect(hero.getByRole("link", { name: "Take the tour" })).toHaveAttribute("href", "/tour/list");
    // Opens over the page (ALL-53), so it's a button, not a link to /request-access.
    expect(hero.getByRole("button", { name: "Request access" })).not.toHaveAttribute("href");
    expect(hero.getByRole("link", { name: "Have an invite? Sign in" })).toHaveAttribute("href", "/auth/login");
  });

  it("the list hero's card shows the list as the asker sees it (ALL-71)", () => {
    render(<WelcomePage />);
    const card = screen.getByTestId("list-preview");
    expect(within(card).getAllByTestId("gift-thumb")).toHaveLength(3);
    for (const thumb of within(card).getAllByTestId("gift-thumb")) expect(thumb.querySelector("svg")).not.toBeNull();
    expect(within(card).getAllByText("Claimed")).toHaveLength(1);
    expect(within(card).getAllByText("Claim")).toHaveLength(2);
  });

  it.each([
    ["list", "Mom", "What do you want for your birthday?"],
    ["concierge", "Reminder", "Mom's birthday is Saturday"],
  ])("the %s hero opens with a phone-notification card, not a tilted sticker (ALL-73)", (which, label, text) => {
    render(<WelcomePage />);
    const hero = which === "list" ? listHero() : conciergeHero();
    const card = within(hero).getByTestId("hero-callout");
    expect(card).toHaveTextContent(label);
    expect(card).toHaveTextContent(text);
    expect(hero.querySelector(".-rotate-3")).toBeNull();
  });

  it("the concierge hero offers its tour and the waitlist (ALL-71)", () => {
    render(<WelcomePage />);
    const hero = within(conciergeHero());
    expect(hero.getByRole("link", { name: "Take the tour" })).toHaveAttribute("href", "/tour");
    expect(hero.getByRole("button", { name: "Join the waitlist" })).toBeInTheDocument();
    expect(hero.queryByRole("button", { name: "Request access" })).not.toBeInTheDocument();
  });

  it("keeps the invite-only way in and How it works", () => {
    render(<WelcomePage />);
    expect(link("🔒 Invite only")).toHaveAttribute("href", "/auth/login");
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

  it("shows how it'll work: the concierge loop, in four steps (ALL-56)", () => {
    render(<WelcomePage />);
    const how = document.getElementById("how-it-works")!;
    const steps = within(how).getAllByRole("listitem");
    expect(steps.map((s) => s.querySelector("span > span")?.textContent)).toEqual([
      "Tell us who you buy for",
      "It learns them",
      "It tells you when",
      "You tap yes",
    ]);
    expect(within(how).getByText(/We buy it and ship it/)).toBeInTheDocument();
    expect(screen.getByText("Nothing is ever bought without your OK.")).toBeInTheDocument();
  });

  it("tells the concierge story right after the hook (ALL-56)", () => {
    render(<WelcomePage />);
    const section = document.getElementById("concierge")!;
    // Straight after the hook, before "What works today".
    const hook = conciergeHero();
    expect(hook.nextElementSibling).toBe(section);
    const story = within(section);
    expect(story.getByRole("heading", { level: 2, name: "It gets to know your people, so you don't have to." })).toBeInTheDocument();
    // It learns from your feedback and theirs, keeps a profile, and recommends.
    expect(section).toHaveTextContent(/your feedback/i);
    expect(section).toHaveTextContent(/how they liked/i);
    expect(section).toHaveTextContent(/no searching/i);
    // It tells you when, and one tap buys and ships.
    expect(section).toHaveTextContent(/tells you when it's time/i);
    expect(section).toHaveTextContent(/one tap/i);
    // Honest about where it is.
    expect(story.getByText("Being built")).toBeInTheDocument();
  });

  it("shows the profile it learns, and where each fact came from (ALL-56)", () => {
    render(<WelcomePage />);
    const card = screen.getByRole("figure", { name: /What it knows about Dad/ });
    for (const fact of ["Loves strong coffee", "Avoid gadgets that need an app"]) {
      expect(within(card).getByText(fact)).toBeInTheDocument();
    }
    for (const source of ["You told us", "His reaction", "His list"]) {
      expect(within(card).getAllByText(source).length).toBeGreaterThan(0);
    }
    expect(within(card).getByText(/3 ideas ready/)).toBeInTheDocument();
  });

  it("asks for feedback and credits the builders", () => {
    render(<WelcomePage />);
    expect(screen.getByRole("button", { name: "Send feedback" })).not.toHaveAttribute("href");
    expect(screen.getByText("GiftsAF alpha · made by Jim and Aaron")).toBeInTheDocument();
  });

  it("sets a title and description for sharing", () => {
    expect(metadata.title).toBe(APP_NAME);
    expect(typeof metadata.description).toBe("string");
    expect(String(metadata.description).length).toBeGreaterThan(0);
  });
});
