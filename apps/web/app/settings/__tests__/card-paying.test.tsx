import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardPaying, type CardPayingActions, type CardPayingInitial, type RemoveCardResult } from "../card-paying";

// Settings > Paying for gifts for a card buyer (ALL-98 mock-ups 4a to 4c). The actions are faked;
// removeCard and saveCardPhone run against the real database in card-db.test.ts, and the page in
// e2e/card-payments.spec.ts.

function setup(o: Partial<CardPayingInitial> = {}, remove: RemoveCardResult = { ok: true }) {
  const actions: CardPayingActions = {
    startCard: vi.fn(async () => ({ ok: true as const, url: "https://checkout.stripe.test/c/cs_1" })),
    remove: vi.fn(async () => remove),
    savePhone: vi.fn(async () => ({ ok: true as const })),
  };
  render(<CardPaying initial={{ on: true, card: { brand: "visa", last4: "4242" }, phone: "5551234567", cardReturn: null, ...o }} actions={actions} />);
  return actions;
}

describe("CardPaying", () => {
  it("AC-13 (4a): the card read from Stripe, Replace and Remove, the phone, and no Zinc", () => {
    setup();
    expect(screen.getByText("Visa ending in 4242")).toBeInTheDocument();
    expect(screen.getByText("Charged only for gifts you approve.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace card" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove card" })).toBeInTheDocument();
    expect(screen.getByText("Stripe keeps your card. We never see the number.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your phone")).toHaveValue("(555) 123-4567");
    expect(document.body).not.toHaveTextContent(/Zinc|balance|top-up/i);
  });

  it("AC-13 (4b): Remove while a gift is being bought says so and keeps the card", async () => {
    const actions = setup({}, { ok: false, error: "placing" });
    await userEvent.click(screen.getByRole("button", { name: "Remove card" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A gift is being bought with this card. You can remove it once that's confirmed.");
    expect(screen.getByText("Visa ending in 4242")).toBeInTheDocument();
    expect(actions.remove).toHaveBeenCalledOnce();
  });

  it("AC-13 (4c): after Remove there's no card, and Add a card says saving buys nothing", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Remove card" }));
    expect(await screen.findByText("No card saved. Add one to buy gifts. Saving a card doesn't buy anything.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a card" })).toBeInTheDocument();
  });

  it("AC-17: no card and no phone asks for the phone with Add a card", async () => {
    const actions = setup({ card: null, phone: null });
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    try {
      await userEvent.type(screen.getByLabelText("Your phone"), "5551234567");
      await userEvent.click(screen.getByRole("button", { name: "Add a card" }));
      expect(actions.startCard).toHaveBeenCalledWith("5551234567");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("AC-12: paused hides Add a card and Replace, but Remove still works", () => {
    setup({ on: false });
    expect(screen.queryByRole("button", { name: "Replace card" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove card" })).toBeInTheDocument();
  });

  it("AC-12: paused with no card says so, with no Add a card", () => {
    setup({ on: false, card: null });
    expect(screen.getByRole("status")).toHaveTextContent("No card saved. Buying is paused right now.");
    expect(screen.queryByRole("button", { name: "Add a card" })).toBeNull();
  });

  it("a card Stripe couldn't be asked about still shows, with Remove", () => {
    setup({ card: "unreadable" });
    expect(screen.getByText("Saved card")).toBeInTheDocument();
    expect(screen.getByText("We couldn't load your card's details just now.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove card" })).toBeInTheDocument();
  });

  it.each([
    ["used", "That card page was already used. If you added a card, it's saved below."],
    ["not_yours", "That card page wasn't yours, so no card was saved."],
    ["cancelled", "No card was saved. Nothing was bought."],
    ["error", "Something went wrong saving your card. Check below before trying again."],
  ])("back from Stripe with card=%s says what happened", (cardReturn, text) => {
    setup({ cardReturn });
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("an unknown card= value shows nothing", () => {
    setup({ cardReturn: "<script>" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("saves the phone", async () => {
    const actions = setup();
    const field = screen.getByLabelText("Your phone");
    await userEvent.clear(field);
    await userEvent.type(field, "5559876543");
    await userEvent.click(screen.getByRole("button", { name: "Save phone" }));
    expect(actions.savePhone).toHaveBeenCalledWith("5559876543");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});
