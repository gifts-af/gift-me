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

describe("request access overlay", () => {
  it("opens the access form over the page", () => {
    render(<RequestAccessButton />);
    fireEvent.click(screen.getByRole("button", { name: "Request access" }));
    const dialog = screen.getByRole("dialog", { name: "Want in?" });
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toBeInTheDocument();
  });

  it("closes on Esc and puts focus back on the button", async () => {
    render(<RequestAccessButton />);
    const open = screen.getByRole("button", { name: "Request access" });
    fireEvent.click(open);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(open).toHaveFocus();
  });

  it("has a close button", async () => {
    render(<RequestAccessButton />);
    fireEvent.click(screen.getByRole("button", { name: "Request access" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

// ALL-71: the concierge hero's "Join the waitlist" uses the same form, tagged.
describe("waitlist overlay", () => {
  const hidden = (dialog: HTMLElement) => dialog.querySelector<HTMLInputElement>('input[name="kind"]')?.value;

  it("Join the waitlist opens the waitlist form", () => {
    render(<RequestAccessButton kind="waitlist" />);
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    const dialog = screen.getByRole("dialog", { name: "Join the waitlist" });
    expect(dialog).toHaveTextContent("The concierge is still being built.");
    expect(hidden(dialog)).toBe("waitlist");
    expect(within(dialog).getByRole("button", { name: "Join the waitlist" })).toHaveAttribute("type", "submit");
  });

  it("Request access posts kind=access", () => {
    render(<RequestAccessButton />);
    fireEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(hidden(screen.getByRole("dialog"))).toBe("access");
  });

  it("thanks them for joining, and offers the list now", async () => {
    submitAccessRequest.mockResolvedValue({ status: "sent" });
    render(<RequestAccessButton kind="waitlist" />);
    fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jo" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jo@example.com" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Join the waitlist" }));
    expect(await screen.findByText("You're on the list. We'll email you when the concierge is ready.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Want your wish list now? Request access" }));
    const dialog = screen.getByRole("dialog", { name: "Want in?" });
    expect(hidden(dialog)).toBe("access");
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
