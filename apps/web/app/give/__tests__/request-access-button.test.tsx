import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RequestAccessButton } from "../request-access-button";

const button = () => screen.getByRole("button");

describe("RequestAccessButton", () => {
  it("is disabled while sending, so a second tap does nothing", async () => {
    let finish!: (r: { status: "sent" }) => void;
    const action = vi.fn(() => new Promise<{ status: "sent" }>((resolve) => (finish = resolve)));
    render(<RequestAccessButton action={action} />);
    expect(button()).toHaveTextContent("Request access");
    fireEvent.click(button());
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent("Sending…");
    fireEvent.click(button());
    expect(action).toHaveBeenCalledOnce();
    // No event or form reaches the server: the action takes nothing.
    expect(action).toHaveBeenCalledWith();
    await act(async () => finish({ status: "sent" }));
    // The page behind it has been re-read by now; this covers one that wasn't.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Request sent");
  });

  it("at the cap, says to try tomorrow and never that it was sent (AC-18)", async () => {
    render(<RequestAccessButton action={async () => ({ status: "busy" })} />);
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole("alert")).toHaveTextContent("We've had a lot of requests today. Please try again tomorrow.");
    expect(screen.queryByText("Request sent")).toBeNull();
  });

  it.each<[string, () => Promise<{ status: "error" }>]>([
    ["fails", async () => ({ status: "error" })],
    ["can't be reached", async () => Promise.reject(new Error("offline"))],
  ])("says so when it %s, and can be tried again", async (_, action) => {
    render(<RequestAccessButton action={action} />);
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't send that just now. Please try again in a minute.");
    expect(button()).toBeEnabled();
  });
});
