import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequestAccess } from "../request-access";

const button = () => screen.getByRole("button");
const ask = <p>What it does</p>;
const sent = <p>Request sent</p>;
type Action = Parameters<typeof RequestAccess>[0]["action"];
const show = (action: Action, requested = false) => render(<RequestAccess action={action} requested={requested} ask={ask} sent={sent} />);

describe("RequestAccess", () => {
  it("is disabled while sending, so a second tap does nothing", async () => {
    let finish!: (r: { status: "sent" }) => void;
    const action = vi.fn(() => new Promise<{ status: "sent" }>((resolve) => (finish = resolve)));
    show(action);
    expect(screen.getByText("What it does")).toBeInTheDocument();
    expect(button()).toHaveTextContent("Request access");
    fireEvent.click(button());
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent("Sending…");
    fireEvent.click(button());
    expect(action).toHaveBeenCalledOnce();
    // No event or form reaches the server: the action takes nothing.
    expect(action).toHaveBeenCalledWith();
    await act(async () => finish({ status: "sent" }));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("What it does")).toBeNull();
  });

  it("announces that it was sent, and moves focus there", async () => {
    const { rerender } = show(async () => ({ status: "sent" }));
    // In the page before there's anything to say, so a screen reader hears it arrive.
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    await act(async () => fireEvent.click(button()));
    expect(status).toHaveTextContent("Request sent");
    expect(status).toHaveFocus();

    // The re-read page says so too, in the same element.
    rerender(<RequestAccess action={async () => ({ status: "sent" })} requested ask={ask} sent={sent} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveFocus();
  });

  it("opened after asking, says it was sent and leaves focus alone", () => {
    show(async () => ({ status: "sent" }), true);
    expect(screen.getByRole("status")).toHaveTextContent("Request sent");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).not.toHaveFocus();
  });

  it("at the cap, says to try tomorrow and never that it was sent (AC-18)", async () => {
    show(async () => ({ status: "busy" }));
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole("alert")).toHaveTextContent("We've had a lot of requests today. Please try again tomorrow.");
    expect(screen.queryByText("Request sent")).toBeNull();
  });

  it.each<[string, () => Promise<{ status: "error" }>]>([
    ["fails", async () => ({ status: "error" })],
    ["can't be reached", async () => Promise.reject(new Error("offline"))],
  ])("says so when it %s, and can be tried again", async (_, action) => {
    show(action);
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't send that just now. Please try again in a minute.");
    expect(button()).toBeEnabled();
  });
});
