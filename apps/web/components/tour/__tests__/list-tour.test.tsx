import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListTour } from "@/components/tour/list-tour";
import { LIST_TOUR_STEPS } from "@/components/tour/tour-data";

// ALL-71: a short tour of your own list, built like the concierge tour.
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
const goTo = (id: (typeof LIST_TOUR_STEPS)[number]["id"]) => {
  for (let i = 0; i < LIST_TOUR_STEPS.findIndex((s) => s.id === id); i++) next();
};

afterEach(() => vi.restoreAllMocks());

describe("list tour (ALL-71)", () => {
  it("walks through the five steps in order", () => {
    render(<ListTour />);
    expect(LIST_TOUR_STEPS.map((s) => s.caption)).toEqual([
      "Add anything you'd like, from any shop.",
      "Someone asks what you want? Text them one link.",
      "They open it and claim a gift, so nobody doubles up.",
      "You never see who got what. It's still a surprise.",
      "That's your list.",
    ]);
    LIST_TOUR_STEPS.forEach((step, i) => {
      expect(screen.getByText(`Step ${i + 1} of 5`)).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1, name: step.caption })).toBeInTheDocument();
      if (i < LIST_TOUR_STEPS.length - 1) next();
    });
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("shows an icon in every gift's picture box on the first step", () => {
    const { container } = render(<ListTour />);
    const boxes = container.querySelectorAll('[data-testid="gift-thumb"]');
    expect(boxes.length).toBe(3);
    boxes.forEach((box) => expect(box.querySelector("svg")).not.toBeNull());
  });

  it("sends the link on step 2", () => {
    render(<ListTour />);
    goTo("share");
    expect(screen.getByText("what do u want for ur bday?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("lets you claim a gift on step 3", () => {
    render(<ListTour />);
    goTo("claim");
    const [first] = screen.getAllByRole("button", { name: /^Claim / });
    fireEvent.click(first);
    expect(screen.getByText("Claimed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Claim / })).toHaveLength(2);
  });

  it("hides claims from you on step 4", () => {
    render(<ListTour />);
    goTo("claim");
    fireEvent.click(screen.getAllByRole("button", { name: /^Claim / })[0]);
    next();
    const screenBox = screen.getByTestId("tour-screen");
    expect(within(screenBox).queryByText("Claimed")).not.toBeInTheDocument();
    expect(within(screenBox).getAllByTestId("gift-thumb")).toHaveLength(3);
  });

  it("ends with Request access, sign in and back to home", () => {
    render(<ListTour />);
    expect(screen.getByRole("link", { name: "Skip tour" })).toHaveAttribute("href", "/");
    goTo("end");
    expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Have an invite? Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });

  it("moves focus to each new step's caption", () => {
    render(<ListTour />);
    next();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: LIST_TOUR_STEPS[1].caption }));
  });

  it("never touches the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ListTour />);
    goTo("claim");
    fireEvent.click(screen.getAllByRole("button", { name: /^Claim / })[0]);
    next();
    next();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
