import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PersonAvatar, initialsOf } from "../person-avatar";

describe("initialsOf", () => {
  it("uses one letter for one word", () => {
    expect(initialsOf("Mom")).toBe("M");
  });
  it("uses the first two words' letters", () => {
    expect(initialsOf("Mary Ann Allen")).toBe("MA");
  });
  it("copes with extra spaces and lower case", () => {
    expect(initialsOf("  jim  ")).toBe("J");
  });
});

describe("PersonAvatar", () => {
  it("shows initials when there is no photo", () => {
    render(<PersonAvatar name="Mary Ann Allen" photoUrl={null} size={40} />);
    expect(screen.getByText("MA")).toBeInTheDocument();
  });

  it("shows the photo when there is one", () => {
    render(<PersonAvatar name="Mom" photoUrl="https://example.test/p.jpg" size={40} />);
    expect(screen.getByRole("img", { name: "Mom" })).toHaveAttribute("src", "https://example.test/p.jpg");
  });

  it("keeps the same color for the same name", () => {
    const { container: a } = render(<PersonAvatar name="Mom" photoUrl={null} size={40} />);
    const { container: b } = render(<PersonAvatar name="Mom" photoUrl={null} size={64} />);
    expect(a.firstElementChild?.className.match(/bg-\S+/)?.[0]).toBe(b.firstElementChild?.className.match(/bg-\S+/)?.[0]);
  });

  it("hides from screen readers when decorative", () => {
    const { container } = render(<PersonAvatar name="Mom" photoUrl={null} size={40} decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    const { container: c2 } = render(<PersonAvatar name="Mom" photoUrl="https://example.test/p.jpg" size={40} decorative />);
    expect(c2.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("falls back to initials when the photo fails to load", () => {
    render(<PersonAvatar name="Mary Ann" photoUrl="https://example.test/old.jpg" size={40} />);
    fireEvent.error(screen.getByRole("img", { name: "Mary Ann" }));
    expect(screen.getByText("MA")).toBeInTheDocument();
  });
});
