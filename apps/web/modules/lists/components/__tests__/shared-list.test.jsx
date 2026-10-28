import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/lists/actions/claims", () => ({ claimGift: vi.fn(), unclaimGift: vi.fn() }));
const { claimGift } = await import("@/modules/lists/actions/claims");
const { default: SharedList } = await import("../shared-list.jsx");

beforeAll(() => {
  // jsdom has <dialog> but not its modal methods.
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
});

const item = (id, name, claim = null) => ({
  id,
  name,
  priceCents: 3200,
  imageUrl: null,
  productUrl: null,
  asin: null,
  source: "manual",
  addedAt: 0,
  claim,
});

const guest = { signedIn: false, email: null, name: null };

describe("SharedList", () => {
  it("lets a friend claim and shows who claimed what", () => {
    render(
      <SharedList
        token="t"
        list={{
          title: "Sam's list",
          isOwner: false,
          viewer: guest,
          items: [item("a", "Board game"), item("b", "Speaker", { name: "Alex", mine: false })],
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Sam's list" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim Board game" })).toBeInTheDocument();
    expect(screen.getByText("Claimed by Alex")).toBeInTheDocument();
  });

  it("shows the owner their list with no claims and nothing to claim", () => {
    render(
      <SharedList
        token="t"
        list={{ title: "My list", isOwner: true, viewer: guest, items: [item("a", "Board game")] }}
      />,
    );
    expect(screen.getByText(/This is your list\. Claims are hidden from you/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Claim/ })).not.toBeInTheDocument();
  });

  it("says so in the dialog when someone else claimed it first", async () => {
    vi.mocked(claimGift).mockResolvedValue({
      ok: false,
      alreadyClaimed: true,
      error: "Someone else just claimed this.",
    });
    render(
      <SharedList
        token="t"
        list={{ title: "Sam's list", isOwner: false, viewer: guest, items: [item("a", "Board game")] }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Claim Board game" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Your name/), "Jordan");
    await userEvent.click(within(dialog).getByRole("button", { name: "Claim gift" }));
    expect(await within(dialog).findByText("Someone else just claimed this. Pick another gift.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Claim gift" })).not.toBeInTheDocument();
  });
});
