import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PickPreview } from "../pick-preview";
import { MOM_GIFTS } from "@/components/tour/tour-data";

// ALL-70: the sample card beside the hook shows the tour's gift icons, not
// empty grey squares (as ALL-62 did for the tour).
describe("the home page sample gift card", () => {
  it("shows Mom's first two tour gifts, each with its icon", () => {
    render(<PickPreview />);
    const card = screen.getByTestId("pick-preview");
    const thumbs = within(card).getAllByTestId("gift-thumb");
    expect(thumbs).toHaveLength(2);
    for (const thumb of thumbs) expect(thumb.querySelector("svg")).not.toBeNull();
    for (const gift of MOM_GIFTS.slice(0, 2)) expect(within(card).getByText(gift.name)).toBeInTheDocument();
  });
});
