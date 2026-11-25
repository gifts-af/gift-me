import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GiftClaim, SharedGift, SharedList as SharedListData } from "@/modules/lists/lib/lists";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/modules/lists/actions/claims", () => ({ claimGift: vi.fn(), unclaimGift: vi.fn() }));
const { claimGift } = await import("@/modules/lists/actions/claims");
const { default: SharedList } = await import("../shared-list");

beforeAll(() => {
  // jsdom has <dialog> but not its modal methods.
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
});

const item = (id: string, name: string, claim: GiftClaim | null = null): SharedGift => ({
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

const guest: SharedListData["viewer"] = { signedIn: false, email: null, name: null };

// The heading fields, for tests that aren't about the heading.
const unnamed = { cardEnabled: false, ownerName: null, linkedPerson: null };

describe("SharedList", () => {
  it("scrolls to the gift the address names, and nowhere without one", () => {
    const scrolled: string[] = [];
    HTMLElement.prototype.scrollIntoView = function () {
      scrolled.push(this.id);
    };
    const list: SharedListData = { title: "t", ...unnamed, isOwner: false, viewer: guest, items: [item("a", "Kettle"), item("b", "Socks")] };
    try {
      render(<SharedList token="t" list={list} />).unmount();
      window.location.hash = "#gift-gone";
      render(<SharedList token="t" list={list} />).unmount();
      expect(scrolled).toEqual([]);
      window.location.hash = "#gift-b";
      const { rerender } = render(<SharedList token="t" list={list} />);
      rerender(<SharedList token="t" list={{ ...list, items: [...list.items] }} />);
      expect(scrolled).toEqual(["gift-b"]);
    } finally {
      window.location.hash = "";
    }
  });

  it("lets a friend claim and shows who claimed what", () => {
    render(
      <SharedList
        token="t"
        list={{
          title: "My list",
          cardEnabled: true,
          ownerName: "Sam",
          linkedPerson: null,
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

  it("offers a quiet way to find out about GiftsAF, after the gifts (ALL-46)", () => {
    render(
      <SharedList
        token="t"
        list={{ ...unnamed, title: "Sam's list", isOwner: false, viewer: guest, items: [item("a", "Board game")] }}
      />,
    );
    const about = screen.getByRole("link", { name: "What is GiftsAF?" });
    expect(about).toHaveAttribute("href", "/");
    const claim = screen.getByRole("button", { name: "Claim Board game" });
    expect(claim.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the owner their list with no claims and nothing to claim", () => {
    render(
      <SharedList
        token="t"
        list={{ ...unnamed, title: "My list", isOwner: true, viewer: guest, items: [item("a", "Board game")] }}
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
        list={{ ...unnamed, title: "Sam's list", isOwner: false, viewer: guest, items: [item("a", "Board game")] }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Claim Board game" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Your name/), "Jordan");
    await userEvent.click(within(dialog).getByRole("button", { name: "Claim gift" }));
    expect(await within(dialog).findByText("Someone else just claimed this. Pick another gift.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Claim gift" })).not.toBeInTheDocument();
  });

  describe("heading (ALL-123)", () => {
    const base = { isOwner: false, cardEnabled: true, viewer: guest, items: [item("a", "Board game")] };
    const heading = () => screen.getByRole("heading", { level: 1 });

    it("names the owner", () => {
      render(<SharedList token="t" list={{ ...base, title: "My list", ownerName: "Sam Lee", linkedPerson: null }} />);
      expect(heading()).toHaveTextContent("Sam Lee's list");
    });

    it("prefers the linked person's name", () => {
      render(
        <SharedList
          token="t"
          list={{ ...base, title: "My list", ownerName: "Sam Lee", linkedPerson: { id: "p", name: "Sammy" } }}
        />,
      );
      expect(heading()).toHaveTextContent("Sammy's list");
    });

    it("says Their list with no name", () => {
      render(<SharedList token="t" list={{ ...base, title: "My list", ownerName: null, linkedPerson: null }} />);
      expect(heading()).toHaveTextContent("Their list");
    });

    it("names nobody with the switch off, not even a linked person (AC-25)", () => {
      render(
        <SharedList
          token="t"
          list={{ ...base, cardEnabled: false, title: "My list", ownerName: "Sam Lee", linkedPerson: { id: "p", name: "Sammy" } }}
        />,
      );
      expect(heading()).toHaveTextContent(/^Their list$/);
    });

    it("still shows the owner their own title with the switch off", () => {
      render(
        <SharedList
          token="t"
          list={{ ...base, cardEnabled: false, isOwner: true, title: "Birthday", ownerName: "Sam Lee", linkedPerson: null }}
        />,
      );
      expect(heading()).toHaveTextContent(/^Birthday$/);
    });

    it("shows the owner their own title", () => {
      render(
        <SharedList token="t" list={{ ...base, isOwner: true, title: "Birthday", ownerName: "Sam Lee", linkedPerson: null }} />,
      );
      expect(heading()).toHaveTextContent("Birthday");
    });

    it.each([
      ["James", "James's list"],
      ["O'Neil", "O'Neil's list"],
    ])("handles apostrophes for %s", (name, expected) => {
      render(<SharedList token="t" list={{ ...base, title: "My list", ownerName: name, linkedPerson: null }} />);
      expect(heading()).toHaveTextContent(expected);
    });

    it("shows a custom title as a smaller line, not the default", () => {
      const { unmount } = render(
        <SharedList token="t" list={{ ...base, title: "Birthday wishes", ownerName: "Sam", linkedPerson: null }} />,
      );
      expect(screen.getByText("Birthday wishes")).toBeInTheDocument();
      unmount();
      render(<SharedList token="t" list={{ ...base, title: "My list", ownerName: "Sam", linkedPerson: null }} />);
      expect(screen.queryByText("My list")).not.toBeInTheDocument();
    });

    it("renders top before the heading", () => {
      render(
        <SharedList token="t" top={<p>Top card</p>} list={{ ...base, title: "My list", ownerName: "Sam", linkedPerson: null }} />,
      );
      expect(screen.getByText("Top card").compareDocumentPosition(heading()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("puts nav in the top bar", () => {
      render(
        <SharedList
          token="t"
          nav={<span>Nav here</span>}
          list={{ ...base, title: "My list", ownerName: "Sam", linkedPerson: null }}
        />,
      );
      expect(screen.getByText("Nav here")).toBeInTheDocument();
    });
  });
});
