import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReadinessBanner } from "../readiness";

describe("ReadinessBanner", () => {
  it("shows the meter and offers the questions (AC-1)", () => {
    render(
      <ReadinessBanner personId="p1" name="Dad" readiness={{ score: 0, label: "Just starting", step: { kind: "answer", count: 5 } }} />,
    );
    const meter = screen.getByRole("meter", { name: "How ready ideas for Dad are" });
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Just starting")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Answer 5 questions" })).toHaveAttribute("href", "/people/p1/questions");
  });

  it("uses the singular for one question", () => {
    render(
      <ReadinessBanner personId="p1" name="Dad" readiness={{ score: 90, label: "Good to go", step: { kind: "answer", count: 1 } }} />,
    );
    expect(screen.getByRole("link", { name: "Answer 1 question" })).toBeInTheDocument();
  });

  it("suggests a capture when no questions are left", () => {
    render(<ReadinessBanner personId="p1" name="Dad" readiness={{ score: 30, label: "Getting there", step: { kind: "capture" } }} />);
    expect(screen.getByText(/Capture a page about Dad/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("suggests nothing when ready", () => {
    render(<ReadinessBanner personId="p1" name="Dad" readiness={{ score: 100, label: "Good to go", step: { kind: "none" } }} />);
    expect(screen.getByRole("meter", { name: "How ready ideas for Dad are" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
