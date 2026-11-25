import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ALL-53: request access and feedback open over the page.
const submitAccessRequest = vi.fn();
const submitFeedback = vi.fn();
vi.mock("@/app/request-access/actions", () => ({ submitAccessRequest: (...a: unknown[]) => submitAccessRequest(...a) }));
vi.mock("@/app/feedback/actions", () => ({ submitFeedback: (...a: unknown[]) => submitFeedback(...a) }));

const { RequestAccessButton } = await import("@/components/home/request-access-dialog");
const { FeedbackButton } = await import("@/components/home/feedback-dialog");

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("request concierge access overlay", () => {
  const open = () => {
    render(<RequestAccessButton variant="secondary" />);
    const button = screen.getByRole("button", { name: "Request concierge access" });
    fireEvent.click(button);
    return button;
  };

  it("opens the form over the page, saying what the concierge is (AC-1)", () => {
    open();
    const dialog = screen.getByRole("dialog", { name: "Request concierge access" });
    expect(dialog).toHaveTextContent(
      "Gift ideas, reminders and buying come with the concierge. We're letting people in a few at a time.",
    );
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Request concierge access" })).toHaveAttribute("type", "submit");
    // The concierge request is the form's only kind.
    expect(dialog.querySelector('input[name="kind"]')).toBeNull();
    expect(dialog).not.toHaveTextContent(/invite/i);
  });

  it("closes on Esc and puts focus back on the button", async () => {
    const button = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });

  it("has a close button", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("thanks them, with a way to start a list, and stays open so it can be used", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    submitAccessRequest.mockResolvedValue({ status: "sent" });
    open();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jo" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jo@example.com" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Request concierge access" }));
    expect(await screen.findByText("Thanks! We'll email you when you're in.")).toBeInTheDocument();
    expect(screen.getByText("Create a free account with this email so we can let you in. You can start your list straight away.")).toBeInTheDocument();
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("link", { name: "Start your list, free" })).toHaveAttribute("href", "/auth/sign-up");
  });
});

describe("feedback overlay", () => {
  it("opens the sad story box over the page, with no email link", () => {
    render(<FeedbackButton />);
    const open = screen.getByRole("button", { name: "Send feedback" });
    expect(open).not.toHaveAttribute("href");
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "Tell us the sad story" });
    expect(within(dialog).getByLabelText("What happened?")).toBeRequired();
    expect(within(dialog).getByLabelText(/Your email/)).not.toBeRequired();
  });

  // Moved down from e2e/home.spec.ts (ALL-118).
  it("closes on Esc and puts focus back on the button", async () => {
    render(<FeedbackButton />);
    const open = screen.getByRole("button", { name: "Send feedback" });
    fireEvent.click(open);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Tell us the sad story" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(open).toHaveFocus();
  });

  it("shows what to fix when the message is empty, and stays open", async () => {
    submitFeedback.mockResolvedValue({ status: "invalid", errors: { message: "Tell us what happened." } });
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Tell us what happened.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the text and says so when sending fails", async () => {
    submitFeedback.mockResolvedValue({ status: "error", message: "We couldn't send that just now. Please try again in a minute." });
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: "It broke" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    expect(screen.getByLabelText("What happened?")).toHaveValue("It broke");
  });

  it("thanks them, then closes itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    submitFeedback.mockResolvedValue({ status: "sent" });
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: "It broke" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Thanks. Got it.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Let the thank-you's effect schedule the close, then jump past it.
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("doesn't close a box reopened soon after sending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    submitFeedback.mockResolvedValue({ status: "sent" });
    render(<FeedbackButton />);
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: "It broke" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Thanks. Got it.")).toBeInTheDocument();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("dialog", { name: "Tell us the sad story" })).toBeInTheDocument();
  });
});
