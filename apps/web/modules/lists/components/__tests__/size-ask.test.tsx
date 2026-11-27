import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity } from "react";
import type { SizeKind } from "@/lib/size-kinds";
import type { Gift, MyList } from "@/modules/lists/lib/lists";

vi.mock("@/modules/lists/actions/lists", () => ({ saveList: vi.fn() }));
vi.mock("@/modules/lists/actions/store-page", () => ({ readStorePage: vi.fn() }));
vi.mock("@/modules/lists/actions/amazon-lookup", () => ({ lookUpAmazon: vi.fn() }));
const { saveList } = await import("@/modules/lists/actions/lists");
const { lookUpAmazon } = await import("@/modules/lists/actions/amazon-lookup");
const { default: GiftApp } = await import("../gift-app");

// Asking for a missing size when a gift that needs one is added (ALL-184).

const member: MyList = {
  user: { email: "jim@example.test" },
  list: { id: "list-1", title: "My list", shareToken: "tok", version: "v1" },
  items: [],
  loadError: null,
};

let version = 1;
let userId = "u1";
let user: ReturnType<typeof userEvent.setup>;
let save: ReturnType<typeof vi.fn<(kind: SizeKind, value: string) => Promise<{ ok: true } | { ok: false; error: string; already?: true }>>>;

async function addByHand(name: string) {
  await user.click(screen.getByRole("button", { name: "Add by hand" }));
  await user.type(screen.getByLabelText("Gift name"), name);
  await user.type(screen.getByLabelText("Price"), "12");
  await user.click(screen.getByRole("button", { name: "Add to list" }));
}

const app = (missing: SizeKind[] = ["top", "pants", "dress", "bra", "shoe", "ring", "hat"]) => (
  <GiftApp initial={member} sizeAsk={{ missing, save, userId }} />
);
const card = () => screen.queryByRole("region", { name: /Add your .* size\?/ });

describe("asking for a missing size", () => {
  beforeEach(() => {
    localStorage.clear();
    userId = "u1";
    user = userEvent.setup();
    version = 1;
    save = vi.fn(async () => ({ ok: true as const }));
    vi.mocked(saveList).mockReset();
    vi.mocked(saveList).mockImplementation(async ({ items }) => ({
      ok: true,
      listId: "list-1",
      shareToken: "tok",
      version: `v${++version}`,
      items: items as Gift[],
    }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("asks for the shirt size when a shirt is added and none is saved (AC-1)", async () => {
    render(app());
    await addByHand("Flannel Shirt");
    expect(card()).toHaveAccessibleName("Add your shirt or top size?");
    expect(screen.getByText(/Anyone with your list link will see it when they go to claim/)).toBeVisible();
    expect(screen.getByText("Add your shirt or top size? Asked below, optional.")).toBeInTheDocument();
    expect(screen.getByLabelText("Shirt or top size")).toBeVisible();
  });

  it("asks for the bra size when a bralette is added and none is saved", async () => {
    render(app());
    await addByHand("Cotton Bralette");
    expect(card()).toHaveAccessibleName("Add your bra size?");
    expect(screen.getByLabelText("Bra size")).toBeVisible();
  });

  it("still asks after a one-tap add from a link (ALL-188 AC-4)", async () => {
    vi.mocked(lookUpAmazon).mockResolvedValue({
      ok: true,
      product: { name: "Flannel Shirt", priceCents: 2999, imageUrl: null, productId: "B0EXAMPLE1" },
    });
    render(app());
    await user.click(screen.getByLabelText("Paste a link"));
    await user.paste("https://www.amazon.com/Flannel-Shirt/dp/B0EXAMPLE1");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("region", { name: "Add your shirt or top size?" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add to list" })).not.toBeInTheDocument();
  });

  it.each<[string, string, SizeKind[]]>([
    ["the size is already saved", "Flannel Shirt", ["shoe"]],
    ["the name matches no kind", "Stanley Tumbler", ["top", "shoe"]],
    ["only favorite color is missing", "Red Kettle", ["color"]],
  ])("doesn't ask when %s (AC-2)", async (_, name, missing) => {
    render(app(missing));
    await addByHand(name);
    expect(card()).toBeNull();
  });

  it("doesn't ask without sizeAsk: guests, or sizes switched off (AC-2)", async () => {
    render(<GiftApp initial={member} />);
    await addByHand("Flannel Shirt");
    expect(card()).toBeNull();
  });

  it("saves that size, then says so with a link to Settings, and doesn't ask again (AC-3, AC-5)", async () => {
    render(app());
    await addByHand("Nike Sneakers");
    await user.type(screen.getByLabelText("Shoe size"), "9.5");
    await user.click(screen.getByRole("button", { name: "Save and share" }));
    expect(save).toHaveBeenCalledWith("shoe", "9.5");
    expect(await screen.findByText(/Saved and shared\. Anyone with your list link will see your shoe size when they go to claim\./)).toBeVisible();
    expect(screen.getByRole("link", { name: "Change it in Settings" })).toHaveAttribute("href", "/settings/sizes");
    await addByHand("Running Shoes");
    expect(card()).toBeNull();
  });

  it("shows a refused value in the card and keeps it open (AC-4)", async () => {
    save.mockResolvedValueOnce({ ok: false, error: "Use 30 characters or fewer." });
    render(app());
    await addByHand("Gold Ring");
    await user.type(screen.getByLabelText("Ring size"), "7");
    await user.click(screen.getByRole("button", { name: "Save and share" }));
    expect(await screen.findByText("Use 30 characters or fewer.")).toBeVisible();
    expect(screen.getByLabelText("Ring size")).toHaveValue("7");
  });

  it("asks for a typed size before calling the server", async () => {
    render(app());
    await addByHand("Gold Ring");
    await user.click(screen.getByRole("button", { name: "Save and share" }));
    expect(screen.getByText("Type a size, or pick Not now.")).toBeVisible();
    expect(save).not.toHaveBeenCalled();
  });

  it("Not now hides it, and that size isn't asked again on this device (AC-5)", async () => {
    const view = render(app());
    await addByHand("Wool Beanie");
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(card()).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "My list" })).toHaveFocus();
    await addByHand("Baseball Cap");
    expect(card()).toBeNull();
    view.unmount();
    render(app());
    await addByHand("Bucket Hat");
    expect(card()).toBeNull();
    // Other sizes are still asked for.
    await addByHand("Hoodie");
    expect(card()).toHaveAccessibleName("Add your shirt or top size?");
  });

  it("asks for the first missing kind a name matches", async () => {
    render(app(["hat"]));
    await addByHand("Sweater and Beanie Set");
    expect(card()).toHaveAccessibleName("Add your hat size?");
  });

  it("is gone after leaving My list and coming back (AC-6)", async () => {
    const page = (mode: "visible" | "hidden") => <Activity mode={mode}>{app()}</Activity>;
    const view = render(page("visible"));
    await addByHand("Flannel Shirt");
    expect(card()).not.toBeNull();
    view.rerender(page("hidden"));
    await act(async () => {});
    view.rerender(page("visible"));
    expect(card()).toBeNull();
  });

  it("Not now is per account: another account on this device is still asked (AC-5)", async () => {
    const view = render(app());
    await addByHand("Wool Beanie");
    await user.click(screen.getByRole("button", { name: "Not now" }));
    view.unmount();
    userId = "u2";
    render(app());
    await addByHand("Wool Beanie");
    expect(card()).toHaveAccessibleName("Add your hat size?");
  });

  it("doesn't ask again for a size whose save is still on its way, and asks again if it fails", async () => {
    let finish!: (r: { ok: false; error: string }) => void;
    save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    render(app());
    await addByHand("Flannel Shirt");
    await user.type(screen.getByLabelText("Shirt or top size"), "M");
    await user.click(screen.getByRole("button", { name: "Save and share" }));
    await addByHand("Polo Shirt");
    // The card on its way is the only one: no second ask.
    expect(screen.getAllByRole("region", { name: /Add your .* size\?/ })).toHaveLength(1);
    await act(async () => finish({ ok: false, error: "That didn't save. Try again." }));
    await addByHand("Rugby Shirt");
    expect(card()).toHaveAccessibleName("Add your shirt or top size?");
  });

  it("sends one save for two quick presses", async () => {
    let finish!: (r: { ok: true }) => void;
    save.mockReturnValueOnce(new Promise((r) => (finish = r)));
    render(app());
    await addByHand("Gold Ring");
    await user.type(screen.getByLabelText("Ring size"), "7");
    await user.keyboard("{Enter}{Enter}");
    await act(async () => finish({ ok: true }));
    expect(save).toHaveBeenCalledOnce();
  });

  it("keeps a half-typed size when a gift with nothing to ask is added", async () => {
    render(app());
    await addByHand("Flannel Shirt");
    await user.type(screen.getByLabelText("Shirt or top size"), "L");
    await addByHand("Stanley Tumbler");
    expect(screen.getByLabelText("Shirt or top size")).toHaveValue("L");
  });
});
