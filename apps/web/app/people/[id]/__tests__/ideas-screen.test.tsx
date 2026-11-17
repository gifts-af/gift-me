import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDEA_RUN_OFF, ideaRunNotice } from "@gifts-af/core";
import type { IdeaRunOffer, ShownIdea } from "@/modules/concierge";
import { IdeasScreen } from "../ideas/ideas-screen";
import { IDEA_MESSAGES, NO_FACTS } from "../ideas/messages";

// The Gift ideas screen (ALL-27). The action is faked here; the real one runs in
// e2e/suggest-ideas.spec.ts against the fake Gateway and fake Zinc.

type Result = { ok: true; count: number } | { ok: false; error: string };

const VISE: ShownIdea = {
  id: "i1",
  title: "Rotary fly-tying vise",
  retailer: "amazon",
  productUrl: "https://www.amazon.com/dp/B0FAKEVISE",
  retailerProductId: "B0FAKEVISE",
  sellerName: "Amazon.com",
  totalCents: 4754,
  arriveBy: "2026-12-04",
  reason: "They want a new vise.",
  overBudget: false,
};
const OFFER: IdeaRunOffer = { kind: "ready", estimateCents: 40, maxCents: 100 };

function setup({
  ideas = [VISE],
  offer = OFFER,
  action = vi.fn(async (...a: [string]): Promise<Result> => (void a, { ok: true, count: 3 })),
} = {}) {
  render(<IdeasScreen personId="p1" personName="Dad" offer={offer} ideas={ideas} action={action} />);
  return { action };
}

const suggest = () => screen.getByRole("button", { name: "Suggest ideas for Dad" });

describe("IdeasScreen", () => {
  it("shows the button and money notice with the offer", () => {
    setup();
    expect(suggest()).toBeEnabled();
    expect(screen.getByRole("note")).toHaveTextContent(ideaRunNotice(40, 100));
    expect(screen.queryByText(IDEA_RUN_OFF)).toBeNull();
  });

  it("says suggestions are switched off, with no button, while the engine is off", () => {
    setup({ offer: { kind: "off" } });
    expect(screen.getByText("Suggestions are switched off right now.")).toBeInTheDocument();
    expect(screen.queryByText(IDEA_RUN_OFF)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says ideas aren't on the account, with no button, for a buyer without paid features", () => {
    setup({ offer: { kind: "not_paid" } });
    expect(screen.getByText(IDEA_RUN_OFF)).toBeInTheDocument();
    expect(screen.queryByText("Suggestions are switched off right now.")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("disables the button while running", async () => {
    let finish: (r: Result) => void = () => {};
    const action = vi.fn((...a: [string]) => (void a, new Promise<Result>((done) => (finish = done))));
    setup({ action });
    await userEvent.click(suggest());
    expect(action).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(suggest()).toBeDisabled());
    finish({ ok: true, count: 3 });
    await waitFor(() => expect(suggest()).toBeEnabled());
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("shows each error message", async () => {
    for (const error of [...Object.values(IDEA_MESSAGES), IDEA_RUN_OFF]) {
      const { unmount } = render(
        <IdeasScreen personId="p1" personName="Dad" offer={OFFER} ideas={[]} action={async () => ({ ok: false, error })} />,
      );
      await userEvent.click(suggest());
      expect(await screen.findByRole("alert")).toHaveTextContent(error);
      expect(screen.queryByRole("link", { name: /questions/i })).toBeNull();
      unmount();
    }
    // No facts yet: the message, with the way to add some.
    setup({ action: vi.fn(async (): Promise<Result> => ({ ok: false, error: NO_FACTS })) });
    await userEvent.click(suggest());
    expect(await screen.findByRole("alert")).toHaveTextContent(NO_FACTS);
    expect(screen.getByRole("link", { name: "Answer a few questions" })).toHaveAttribute("href", "/people/p1/questions");
  });

  it("shows each idea: title, store, full cost, arrival and reason, keeping its product id", () => {
    setup();
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("Rotary fly-tying vise");
    expect(item).toHaveTextContent("$47.54 · Amazon");
    expect(item).toHaveTextContent("Arrives by Fri, Dec 4 if ordered today");
    expect(item).toHaveTextContent("They want a new vise.");
    expect(item).toHaveAttribute("data-retailer-product-id", "B0FAKEVISE");
    expect(item).not.toHaveTextContent("Over budget");
  });

  it("labels the over-budget idea", () => {
    setup({ ideas: [VISE, { ...VISE, id: "i2", title: "Fly line", retailerProductId: "B0FAKELINE", overBudget: true }] });
    const [within, over] = screen.getAllByRole("listitem");
    expect(within).not.toHaveTextContent("Over budget");
    expect(over).toHaveTextContent("Over budget");
  });

  it("no arrival date without an occasion", () => {
    setup({ ideas: [{ ...VISE, arriveBy: null }] });
    expect(screen.getByRole("listitem")).not.toHaveTextContent("Arrives by");
  });
});
