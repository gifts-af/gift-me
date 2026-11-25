import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_NAME } from "@/lib/brand";

const submitFeedback = vi.fn();
vi.mock("@/app/feedback/actions", () => ({ submitFeedback: (...a: unknown[]) => submitFeedback(...a) }));
const { default: FeedbackPage, metadata } = await import("@/app/feedback/page");

afterEach(() => vi.clearAllMocks());

async function send(message: string) {
  fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: message } });
  fireEvent.click(await screen.findByRole("button", { name: "Send" }));
}

describe("the feedback page", () => {
  it("is titled, and shows the form on the page", () => {
    render(<FeedbackPage />);
    expect(metadata.title).toBe(`Feedback · ${APP_NAME}`);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText("What happened?")).toBeRequired();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for an email when the note is about erasing (AC-22)", () => {
    render(<FeedbackPage />);
    expect(screen.getByText(/erase/)).toHaveTextContent(/leave your email/i);
  });

  it("thanks them without saying it will close, since there is nothing to close", async () => {
    submitFeedback.mockResolvedValue({ status: "sent" });
    render(<FeedbackPage />);
    await send("Please erase my account");
    expect(await screen.findByText("Thanks. Got it.")).toBeInTheDocument();
    expect(screen.queryByText(/closes itself/)).not.toBeInTheDocument();
  });

  it("keeps the text and says so when sending fails", async () => {
    submitFeedback.mockResolvedValue({ status: "error", message: "Please try again in a minute." });
    render(<FeedbackPage />);
    await send("It broke");
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    expect(screen.getByLabelText("What happened?")).toHaveValue("It broke");
  });
});
