import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PersonCard as Card } from "@/modules/concierge";
import { PersonCard } from "../person-card";

const base: Card = {
  id: "p1",
  name: "Mom",
  relationship: "mother",
  photoUrl: null,
  next: { kind: "birthday", date: "2027-03-13" },
  keepsList: true,
  hasBirthday: true,
};

describe("PersonCard", () => {
  it("shows the name, the next occasion and a link to the person", () => {
    render(<PersonCard person={base} />);
    expect(screen.getByRole("link", { name: "Mom" })).toHaveAttribute("href", "/people/p1");
    expect(screen.getByText("Birthday · Sat, Mar 13")).toBeInTheDocument();
  });

  it("names holidays in plain words", () => {
    render(<PersonCard person={{ ...base, next: { kind: "mothers_day", date: "2027-05-09" } }} />);
    expect(screen.getByText("Mother's Day · Sun, May 9")).toBeInTheDocument();
  });

  it("says 'Their own list' when they keep one, 'We suggest ideas' when not", () => {
    const { rerender } = render(<PersonCard person={base} />);
    expect(screen.getByText("Their own list")).toBeInTheDocument();
    expect(screen.queryByText("We suggest ideas")).toBeNull();
    rerender(<PersonCard person={{ ...base, keepsList: false }} />);
    expect(screen.getByText("We suggest ideas")).toBeInTheDocument();
    expect(screen.queryByText("Their own list")).toBeNull();
  });

  it("offers 'Add birthday' only when there is no birthday", () => {
    const { rerender } = render(<PersonCard person={base} />);
    expect(screen.queryByRole("link", { name: "Add birthday" })).toBeNull();
    rerender(<PersonCard person={{ ...base, hasBirthday: false }} />);
    expect(screen.getByRole("link", { name: "Add birthday" })).toHaveAttribute("href", "/people/p1#birthday");
  });
});
