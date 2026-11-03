import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import GiftList from "../gift-list.jsx";

describe("GiftList", () => {
  it("invites a link from any store when the list is empty (ALL-10)", () => {
    render(<GiftList gifts={[]} />);
    expect(
      screen.getByText("Nothing here yet. Paste a link from any store above, or add a gift by hand."),
    ).toBeInTheDocument();
  });
});
