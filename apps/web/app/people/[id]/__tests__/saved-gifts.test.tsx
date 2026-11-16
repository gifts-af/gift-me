import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SavedGifts, type ShownGift } from "../saved-gifts";

// Saved gifts on a person's page (ALL-93). The actions are faked here; the
// real ones are covered by the service tests, pgTAP and e2e/people.spec.ts.

type Result = { ok: true } | { ok: false; error: string };
type Read =
  | { ok: true; name: string | null; priceCents: number | null; imageUrl: string | null; productUrl: string }
  | { ok: false; error: string };

const REEL: ShownGift = {
  id: "g1",
  name: "Fly-fishing reel",
  priceCents: 4900,
  productUrl: "https://www.amazon.com/dp/B0TESTREEL",
  imageUrl: null,
  store: "Amazon",
};

function setup({
  gifts = [] as ShownGift[],
  read = vi.fn(async (): Promise<Read> => ({ ok: true, name: "Mug", priceCents: 1200, imageUrl: null, productUrl: "https://shop.example/mug" })),
  save = vi.fn(async (...a: [unknown, FormData]): Promise<Result> => (void a, { ok: true })),
  remove = vi.fn(async (...a: [unknown, FormData]): Promise<Result> => (void a, { ok: true })),
} = {}) {
  render(<SavedGifts personId="p1" name="Dad" gifts={gifts} readAction={read} saveAction={save} removeAction={remove} />);
  return { read, save, remove };
}

const nameField = () => screen.getByLabelText("Gift") as HTMLInputElement;
const priceField = () => screen.getByLabelText("Price") as HTMLInputElement;
const linkField = () => screen.getByLabelText("Link") as HTMLInputElement;

describe("SavedGifts", () => {
  it("says what it's for and who can see it", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Saved gifts" })).toBeInTheDocument();
    expect(screen.getByText("Only you see these. Dad never does.")).toBeInTheDocument();
    expect(screen.getByText("Keep gifts you spot for Dad here.")).toBeInTheDocument();
  });

  it("fills the name and price from a pasted link", async () => {
    const { read } = setup();
    await userEvent.type(linkField(), "https://shop.example/mug");
    await waitFor(() => expect(nameField().value).toBe("Mug"));
    expect(priceField().value).toBe("12.00");
    expect(read).toHaveBeenLastCalledWith("https://shop.example/mug");
  });

  it("leaves a typed name alone when the read fails or comes back", async () => {
    setup({ read: vi.fn(async (): Promise<Read> => ({ ok: false, error: "nope" })) });
    await userEvent.type(nameField(), "My name");
    await userEvent.type(linkField(), "https://shop.example/mug");
    await waitFor(() => expect(linkField().value).toBe("https://shop.example/mug"));
    expect(nameField().value).toBe("My name");
  });

  it("doesn't overwrite a name typed before the read came back", async () => {
    setup();
    await userEvent.type(nameField(), "Blue mug for Dad");
    await userEvent.type(linkField(), "https://shop.example/mug");
    await waitFor(() => expect(priceField().value).toBe("12.00"));
    expect(nameField().value).toBe("Blue mug for Dad");
  });

  it("doesn't refill the form when a read lands after Save cleared it", async () => {
    let finish: (r: Read) => void = () => {};
    const read = vi.fn(() => new Promise<Read>((resolve) => (finish = resolve)));
    setup({ read });
    await userEvent.type(nameField(), "Mug");
    await userEvent.type(linkField(), "https://shop.example/mug");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(nameField().value).toBe(""));
    await act(async () => finish({ ok: true, name: "Late", priceCents: 500, imageUrl: null, productUrl: "https://shop.example/mug" }));
    expect(nameField().value).toBe("");
    expect(priceField().value).toBe("");
  });

  it("sends what was typed with the person, and clears the form after", async () => {
    const { save } = setup();
    await userEvent.type(nameField(), "Coffee sampler");
    await userEvent.type(priceField(), "20");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const form = save.mock.calls[0][1];
    expect([form.get("id"), form.get("name"), form.get("price"), form.get("link")]).toEqual(["p1", "Coffee sampler", "20", ""]);
    await waitFor(() => expect(nameField().value).toBe(""));
  });

  it("shows why a save failed and keeps what was typed", async () => {
    setup({ save: vi.fn(async (): Promise<Result> => ({ ok: false, error: "Enter an amount like 75 or 75.50." })) });
    await userEvent.type(nameField(), "Mug");
    await userEvent.type(priceField(), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter an amount like 75 or 75.50.");
    expect(nameField().value).toBe("Mug");
    expect(priceField().value).toBe("abc");
  });

  it("says to try again when the save can't reach the server, and keeps what was typed", async () => {
    setup({ save: vi.fn(async (): Promise<Result> => Promise.reject(new Error("offline"))) });
    await userEvent.type(nameField(), "Mug");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't save. Try again.");
    expect(nameField().value).toBe("Mug");
  });

  it("saves once even when Save is tapped twice", async () => {
    let finish: (r: Result) => void = () => {};
    const save = vi.fn(() => new Promise<Result>((resolve) => (finish = resolve)));
    setup({ save });
    await userEvent.type(nameField(), "Mug");
    const button = screen.getByRole("button", { name: "Save" });
    await userEvent.click(button);
    await userEvent.click(button);
    await act(async () => finish({ ok: true }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("lists a gift with its price and store, opening the store page in a new tab", () => {
    setup({ gifts: [REEL, { ...REEL, id: "g2", name: "Coffee sampler", priceCents: null, productUrl: null, store: null }] });
    const link = screen.getByRole("link", { name: "Fly-fishing reel" });
    expect(link).toHaveAttribute("href", "https://www.amazon.com/dp/B0TESTREEL");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("$49.00 · Amazon")).toBeInTheDocument();
    expect(screen.getByText("No price")).toBeInTheDocument();
    expect(screen.queryByText("Keep gifts you spot for Dad here.")).not.toBeInTheDocument();
  });

  it("removes a gift", async () => {
    const { remove } = setup({ gifts: [REEL] });
    await userEvent.click(screen.getByRole("button", { name: "Remove Fly-fishing reel" }));
    await waitFor(() => expect(remove).toHaveBeenCalled());
    const form = remove.mock.calls[0][1];
    expect([form.get("id"), form.get("gift")]).toEqual(["p1", "g1"]);
  });
});
