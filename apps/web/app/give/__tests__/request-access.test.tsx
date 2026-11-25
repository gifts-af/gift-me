import { Activity } from "react";
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

  // Next.js keeps a page you leave in a hidden <Activity>, and shows it again on your return.
  describe("left and come back to", () => {
    const page = (mode: "visible" | "hidden", action: Action, requested = false) => (
      <Activity mode={mode}>
        <RequestAccess action={action} requested={requested} ask={ask} sent={sent} />
      </Activity>
    );
    async function leaveAndReturn(action: Action, requestedOnReturn = false) {
      const { rerender } = render(page("visible", action));
      await act(async () => fireEvent.click(button()));
      await act(async () => rerender(page("hidden", action, requestedOnReturn)));
      (document.activeElement as HTMLElement).blur();
      await act(async () => rerender(page("visible", action, requestedOnReturn)));
    }

    it("after asking, still says it was sent, from the re-read page, and leaves focus alone", async () => {
      await leaveAndReturn(async () => ({ status: "sent" }), true);
      expect(screen.getByRole("status")).toHaveTextContent("Request sent");
      expect(screen.getByRole("status")).not.toHaveFocus();
    });

    it("keeps nothing of its own: only the page's re-read says it was sent", async () => {
      await leaveAndReturn(async () => ({ status: "sent" }));
      expect(screen.queryByText("Request sent")).toBeNull();
      expect(document.body).toHaveFocus();
      expect(button()).toBeEnabled();
    });

    it.each(["busy", "error"] as const)("drops the %s message", async (status) => {
      await leaveAndReturn(async () => ({ status }));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(button()).toBeEnabled();
    });

    it.each(["sent", "busy", "error"] as const)("drops a %s answer that came while it was hidden", async (status) => {
      let finish!: (r: { status: typeof status }) => void;
      const action = () => new Promise<{ status: typeof status }>((resolve) => (finish = resolve));
      const { rerender } = render(page("visible", action));
      fireEvent.click(button());
      await act(async () => rerender(page("hidden", action)));
      await act(async () => finish({ status }));
      await act(async () => rerender(page("visible", action)));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText("Request sent")).toBeNull();
      expect(document.body).toHaveFocus();
      expect(button()).toBeEnabled();
    });
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
