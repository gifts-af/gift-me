import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { YouCard } from "../you-card";

describe("YouCard", () => {
  it.each([
    [12, "Treat yourself · 12 gifts on your list"],
    [1, "Treat yourself · 1 gift on your list"],
    [0, "Treat yourself · Start your wish list"],
  ])("with %s gifts says what's on the list", (count, line) => {
    render(<YouCard count={count} />);
    const card = screen.getByRole("link", { name: /^You/ });
    expect(card).toHaveAttribute("href", "/lists");
    expect(card).toHaveTextContent(line);
  });

  it("never invites someone to start a list when the count can't be read", () => {
    render(<YouCard count={null} />);
    const card = screen.getByRole("link", { name: /^You/ });
    expect(card).toHaveAttribute("href", "/lists");
    expect(card).toHaveTextContent("Your list");
    expect(card).not.toHaveTextContent("Start");
    expect(card).not.toHaveTextContent("gift");
  });

  it("is still a working link while loading, with no claims about the list", () => {
    render(<YouCard />);
    const card = screen.getByRole("link", { name: /^You/ });
    expect(card).toHaveAttribute("href", "/lists");
    expect(card).not.toHaveTextContent("Start");
    expect(card).not.toHaveTextContent("gift");
  });
});
