import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDEA_RUN_OFF, ideaRunNotice } from "@gifts-af/core";
import type { IdeaRunOffer, ShownIdea } from "@/modules/concierge";
import { IdeasScreen } from "../ideas/ideas-screen";
import { IDEA_MESSAGES, NO_FACTS } from "../ideas/messages";

// The Gift ideas screen (ALL-27) and Save on an idea (ALL-128). The actions are faked here; the
// real ones run in e2e/suggest-ideas.spec.ts against the fake Gateway and fake Zinc.

type Result = { ok: true; count: number } | { ok: false; error: string };
type SaveResult = { ok: true } | { ok: false; error: string };

const VISE: ShownIdea = {
  id: "i1",
  title: "Rotary fly-tying vise",
  retailer: "amazon",
  productUrl: "https://www.amazon.com/dp/B0FAKEVISE",
  imageUrl: "https://m.media-amazon.com/images/I/vise.jpg",
  retailerProductId: "B0FAKEVISE",
  sellerName: "Amazon.com",
  priceCents: 4299,
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
  saved = [] as string[],
  saveAction = vi.fn(async (...a: [string, string]): Promise<SaveResult> => (void a, { ok: true })),
} = {}) {
  render(
    <IdeasScreen
      personId="p1"
      personName="Dad"
      offer={offer}
      ideas={ideas}
      action={action}
      savedProductIds={saved}
      saveAction={saveAction}
    />,
  );
  return { action, saveAction };
}

const suggest = () => screen.getByRole("button", { name: "Suggest ideas for Dad" });

describe("IdeasScreen", () => {
  it("shows the item's own price, as saved gifts do, then the whole cost", () => {
    setup();
    expect(screen.getByText("$42.99 · Amazon")).toBeInTheDocument();
    expect(screen.getByText("About $47.54 with shipping, tax and fee")).toBeInTheDocument();
  });

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
    expect(screen.queryByRole("button", { name: /^Suggest/ })).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("says ideas aren't on the account, with no button, for a buyer without paid features", () => {
    setup({ offer: { kind: "not_paid" } });
    expect(screen.getByText(IDEA_RUN_OFF)).toBeInTheDocument();
    expect(screen.queryByText("Suggestions are switched off right now.")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Suggest/ })).toBeNull();
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
        <IdeasScreen
          personId="p1"
          personName="Dad"
          offer={OFFER}
          ideas={[]}
          action={async () => ({ ok: false, error })}
          savedProductIds={[]}
          saveAction={async () => ({ ok: true })}
        />,
      );
      await userEvent.click(suggest());
      expect(await screen.findByRole("alert")).toHaveTextContent(error);
      expect(screen.queryByRole("link", { name: /questions/i })).toBeNull();
      unmount();
    }
    // No facts yet: the message, with the way to add some (What we know, ALL-186).
    setup({ action: vi.fn(async (): Promise<Result> => ({ ok: false, error: NO_FACTS })) });
    await userEvent.click(suggest());
    expect(await screen.findByRole("alert")).toHaveTextContent(NO_FACTS);
    expect(screen.getByRole("link", { name: "Add something" })).toHaveAttribute("href", "/people/p1/know");
  });

  it("shows each idea: title, store, price, full cost, arrival and reason, keeping its product id", () => {
    setup();
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("Rotary fly-tying vise");
    expect(item).toHaveTextContent("$42.99 · Amazon");
    expect(item).toHaveTextContent("About $47.54");
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

describe("Save on an idea (ALL-128)", () => {
  const save = () => screen.getByRole("button", { name: "Save Rotary fly-tying vise" });

  it("saves the idea by its id and then shows it as saved", async () => {
    const { saveAction } = setup();
    await userEvent.click(save());
    expect(saveAction).toHaveBeenCalledWith("p1", "i1");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Rotary fly-tying vise" })).toBeNull();
  });

  it("shows Saved, with no button, for a product already in saved gifts", () => {
    setup({ saved: ["B0FAKEVISE"] });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save / })).toBeNull();
  });

  it("can't be tapped twice while saving", async () => {
    let finish: (r: SaveResult) => void = () => {};
    const saveAction = vi.fn((...a: [string, string]) => (void a, new Promise<SaveResult>((done) => (finish = done))));
    setup({ saveAction });
    await userEvent.click(save());
    await waitFor(() => expect(save()).toBeDisabled());
    await userEvent.click(save());
    expect(saveAction).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("shows the error under the idea and keeps the button", async () => {
    setup({ saveAction: vi.fn(async () => ({ ok: false as const, error: "This idea was replaced. Refresh to see the new ones." })) });
    await userEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("This idea was replaced. Refresh to see the new ones.");
    expect(save()).toBeEnabled();
  });

  it("still offers Save while suggestions are switched off", () => {
    setup({ offer: { kind: "off" } });
    expect(save()).toBeEnabled();
  });

  it("offers no Save for an idea with no product id", () => {
    setup({ ideas: [{ ...VISE, retailerProductId: null }] });
    expect(screen.queryByRole("button", { name: /^Save / })).toBeNull();
  });

  it("shows each idea's photo with no referrer, or the gift icon without one (ALL-29 AC-17)", () => {
    setup({ ideas: [VISE, { ...VISE, id: "i2", title: "Fly box", imageUrl: null, retailerProductId: "B0BOX" }] });
    const photo = screen.getByRole("img", { name: VISE.title });
    expect(photo.tagName).toBe("IMG");
    expect(photo).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByRole("img", { name: "Fly box" }).tagName).not.toBe("IMG");
  });
});
