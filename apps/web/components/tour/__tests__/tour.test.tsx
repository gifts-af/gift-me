import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tour } from "@/components/tour/tour";
import { TOUR_STEPS } from "@/components/tour/tour-data";

function next() {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

function goTo(id: (typeof TOUR_STEPS)[number]["id"]) {
  const target = TOUR_STEPS.findIndex((s) => s.id === id);
  for (let i = 0; i < target; i++) next();
}

afterEach(() => vi.restoreAllMocks());

describe("guided tour (ALL-46)", () => {
  it("has no alpha banner above the top bar (ALL-50)", () => {
    render(<Tour />);
    expect(screen.queryByText(/Lots is broken/)).not.toBeInTheDocument();
  });

  it.each(["pick", "ideas", "list"] as const)("shows an icon in every gift's picture box on the %s step", (id) => {
    const { container } = render(<Tour />);
    goTo(id);
    const boxes = container.querySelectorAll('[data-testid="gift-thumb"]');
    expect(boxes.length).toBe(3);
    boxes.forEach((box) => expect(box.querySelector("svg")).not.toBeNull());
  });

  it("walks through all seven steps in order", () => {
    render(<Tour />);
    TOUR_STEPS.forEach((step, i) => {
      expect(screen.getByText(`Step ${i + 1} of 7`)).toBeInTheDocument();
      expect(screen.getByText(step.caption)).toBeInTheDocument();
      if (i < TOUR_STEPS.length - 1) next();
    });
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("adds up picks and resets when nothing is picked", () => {
    render(<Tour />);
    goTo("pick");
    const send = () => screen.getByRole("button", { name: /Pick a gift|Send/ });
    expect(send()).toHaveTextContent("Pick a gift");
    expect(send()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Stoneware mug set/ }));
    expect(send()).toHaveTextContent("Send 1 gift · $42");
    fireEvent.click(screen.getByRole("button", { name: /Cast-iron herb planter/ }));
    expect(send()).toHaveTextContent("Send 2 gifts · $110");

    fireEvent.click(screen.getByRole("button", { name: /Stoneware mug set/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cast-iron herb planter/ }));
    expect(send()).toHaveTextContent("Pick a gift");
    expect(send()).toBeDisabled();
  });

  it("sends the picks on to the next step", () => {
    render(<Tour />);
    goTo("pick");
    fireEvent.click(screen.getByRole("button", { name: /Stoneware mug set/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send 1 gift · $42" }));
    expect(screen.getByText("Step 3 of 7")).toBeInTheDocument();
  });

  it("moves focus to each new step's caption, including the last", () => {
    render(<Tour />);
    next();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: TOUR_STEPS[1].caption }));
    for (let i = 1; i < TOUR_STEPS.length - 1; i++) next();
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: TOUR_STEPS[6].caption }));
  });

  it("is honest that nothing was bought", () => {
    render(<Tour />);
    goTo("done");
    expect(screen.getByText("Ordered. (Not really, this is the tour.)")).toBeInTheDocument();
  });

  it("can be left at any step, and ends with a way in", () => {
    render(<Tour />);
    expect(screen.getByRole("link", { name: "Skip tour" })).toHaveAttribute("href", "/");
    goTo("end");
    expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Have an invite? Sign in" })).toHaveAttribute("href", "/auth/login");
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });

  it("goes back a step", () => {
    render(<Tour />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 7")).toBeInTheDocument();
  });

  it("never touches the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<Tour />);
    goTo("pick");
    fireEvent.click(screen.getByRole("button", { name: /Stoneware mug set/ }));
    for (let i = TOUR_STEPS.findIndex((s) => s.id === "pick"); i < TOUR_STEPS.length - 1; i++) next();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
