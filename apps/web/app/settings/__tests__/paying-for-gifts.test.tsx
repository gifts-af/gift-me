import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentResult } from "@/modules/concierge";
import { PayingForGifts, type PayingActions } from "../paying-for-gifts";

const waiting = {
  kind: "waiting" as const,
  userCode: "K7QX-4M2P",
  verificationUrl: "https://zinc.test/activate?c=K7QX-4M2P",
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  intervalSec: 5,
};
const connected = {
  kind: "connected" as const,
  balanceCents: 4000,
  autoTopUp: null,
  lookahead: { cents: 0, atLeast: false },
  lookaheadDays: 21,
  feeCents: 100,
  topUpFeeBps: 290,
  topUpFeeFixedCents: 30,
  suggestedMinimumCents: 10100,
  topUpSuggestCents: 10000,
  phone: null,
  placingCount: 0,
  onTheWayCount: 0,
};

function actionsWith(poll: PayingActions["poll"]): PayingActions {
  const never = vi.fn(async (): Promise<PaymentResult> => ({ error: "unused" }));
  return { start: never, poll, cancel: never, disconnect: never, savePhone: never };
}

describe("PayingForGifts polling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps polling after a poll comes back with an error, and shows the error meanwhile", async () => {
    const poll = vi
      .fn<PayingActions["poll"]>()
      .mockResolvedValueOnce({ error: "We couldn't reach Zinc. Try again in a minute." })
      .mockResolvedValueOnce(waiting)
      .mockResolvedValueOnce(connected);
    render(<PayingForGifts initial={waiting} actions={actionsWith(poll)} walletUrl="https://zinc.test/wallet" />);

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(poll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't reach Zinc");
    expect(screen.getByText("Waiting for you to click Allow…")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(poll).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(poll).toHaveBeenCalledTimes(3);
    expect(screen.getByText("$40.00")).toBeInTheDocument();
  });

  it("keeps polling when the call itself throws", async () => {
    const poll = vi.fn<PayingActions["poll"]>().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(connected);
    render(<PayingForGifts initial={waiting} actions={actionsWith(poll)} walletUrl="https://zinc.test/wallet" />);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(poll).toHaveBeenCalledTimes(2);
    expect(screen.getByText("$40.00")).toBeInTheDocument();
  });
});

describe("PayingForGifts connected", () => {
  it("builds the top-up fee from settings and links to the configured wallet address", () => {
    render(<PayingForGifts initial={connected} actions={actionsWith(vi.fn())} walletUrl="https://zinc.test/wallet" />);
    expect(screen.getByText("Each top-up costs 2.9% + 30¢.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Zinc wallet" })).toHaveAttribute("href", "https://zinc.test/wallet");
  });

  it("won't offer Disconnect while a gift is being ordered, and says why", () => {
    render(<PayingForGifts initial={{ ...connected, placingCount: 1 }} actions={actionsWith(vi.fn())} walletUrl="x" />);
    expect(screen.getByRole("button", { name: "Disconnect Zinc" })).toBeDisabled();
    expect(screen.getByText("A gift is being ordered right now. You can disconnect once it has gone through.")).toBeInTheDocument();
  });

  it("shows a plain line when the section couldn't load", () => {
    render(
      <PayingForGifts initial={{ kind: "message", text: "We couldn't load your payment settings." }} actions={actionsWith(vi.fn())} walletUrl="" />,
    );
    expect(screen.getByText("We couldn't load your payment settings.")).toBeInTheDocument();
  });
});

// S7 (owner): a saved Zinc key can always be removed, even where buying is off for the user.
describe("PayingForGifts disconnect-only line", () => {
  it("offers Disconnect next to the line when a key is still saved, and shows what comes back", async () => {
    const disconnect = vi.fn(async (): Promise<PaymentResult> => ({ kind: "message", text: "Disconnected. To finish, revoke the key in your Zinc account too." }));
    const actions = { ...actionsWith(vi.fn()), disconnect };
    render(
      <PayingForGifts
        initial={{ kind: "message", text: "Paying for gifts isn't switched on here yet.", canDisconnect: true }}
        actions={actions}
        walletUrl=""
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Zinc" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Disconnected. To finish, revoke the key in your Zinc account too.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect Zinc" })).not.toBeInTheDocument();
  });

  it("offers no Disconnect on a plain line without a saved key", () => {
    render(<PayingForGifts initial={{ kind: "message", text: "Paying for gifts isn't switched on here yet." }} actions={actionsWith(vi.fn())} walletUrl="" />);
    expect(screen.queryByRole("button", { name: "Disconnect Zinc" })).not.toBeInTheDocument();
  });
});
