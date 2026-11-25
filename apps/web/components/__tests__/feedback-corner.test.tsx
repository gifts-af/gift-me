import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/feedback/actions", () => ({ submitFeedback: vi.fn() }));

const { FeedbackCorner } = await import("@/components/feedback-corner");

// A quiet "Feedback" link in the bottom-left corner on a computer, on every page.
describe("feedback corner", () => {
  it("sits in the bottom-left corner and only shows on a wide screen", () => {
    const { container } = render(<FeedbackCorner />);
    const corner = container.firstElementChild!;
    expect(corner).toHaveClass("fixed", "bottom-4", "left-4", "hidden", "xl:block");
  });

  it("opens the feedback box", () => {
    render(<FeedbackCorner />);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(screen.getByRole("dialog", { name: "Tell us the sad story" })).toBeInTheDocument();
  });
});
