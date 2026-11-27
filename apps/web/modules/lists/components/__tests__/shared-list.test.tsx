import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GiftClaim, SharedGift, SharedList as SharedListData } from "@/modules/lists/lib/lists";

const router = { refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
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

const guest: SharedListData["viewer"] = { signedIn: false, name: null };

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

  describe("where the card goes (ALL-179)", () => {
    const card = <section aria-label="Card">card</section>;
    const listFor = (viewer: SharedListData["viewer"]): SharedListData => ({
      title: "t",
      ...unnamed,
      isOwner: false,
      viewer,
      items: [item("a", "Kettle")],
    });
    const follows = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    it("signed out, the heading and claim sentence come first and the card sits above the gifts", () => {
      render(<SharedList token="t" list={listFor(guest)} top={card} />);
      const heading = screen.getByRole("heading", { level: 1 });
      const claimLine = screen.getByText(/Planning to buy something/);
      const cardEl = screen.getByRole("region", { name: "Card" });
      expect(follows(heading, cardEl)).toBe(true);
      expect(follows(claimLine, cardEl)).toBe(true);
      expect(follows(cardEl, screen.getByRole("button", { name: "Claim Kettle" }))).toBe(true);
    });

    it("signed in, the card stays above the heading", () => {
      render(<SharedList token="t" list={listFor({ signedIn: true, name: "Pat" })} top={card} />);
      expect(follows(screen.getByRole("region", { name: "Card" }), screen.getByRole("heading", { level: 1 }))).toBe(true);
    });
  });

  it("the claim box shows the name friends will see", async () => {
    const viewer = { signedIn: true, name: "Someone" };
    render(<SharedList token="t" list={{ title: "t", ...unnamed, isOwner: false, viewer, items: [item("a", "Kettle")] }} />);
    await userEvent.click(screen.getByRole("button", { name: /claim/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Claiming as Someone.");
  });

  it("the claim box offers sign-in and sign-up, both coming back to this list", async () => {
    render(<SharedList token="t" list={{ title: "t", ...unnamed, isOwner: false, viewer: guest, items: [item("a", "Kettle")] }} />);
    await userEvent.click(screen.getByRole("button", { name: /claim/i }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login?next=%2Fshare%2Ft");
    expect(dialog.getByRole("link", { name: "create an account" })).toHaveAttribute("href", "/auth/sign-up?next=%2Fshare%2Ft");
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
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "/feedback");
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

    it("renders top before the heading when signed in", () => {
      render(
        <SharedList token="t" top={<p>Top card</p>} list={{ ...base, viewer: { signedIn: true, name: "Pat" }, title: "My list", ownerName: "Sam", linkedPerson: null }} />,
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

describe("the sizes fetch (AC-5, AC-7)", () => {
  const listFor = (isOwner: boolean): SharedListData => ({
    title: "t",
    cardEnabled: true,
    ownerName: "Aaron",
    linkedPerson: null,
    isOwner,
    viewer: guest,
    items: [{ ...item("a", "Sneakers"), productUrl: "https://www.target.com/p/x" }],
  });
  const sizes = [{ kind: "shoe", value: "10.5" }];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  async function open() {
    await userEvent.click(screen.getByRole("link", { name: /View on/ }));
  }

  it("fetches once per visit and the box shows the result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sizes });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { rerender } = render(<SharedList token="tok" list={listFor(false)} />);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0][0]).toBe("/share/tok/sizes");
      await settle();
      rerender(<SharedList token="tok" list={{ ...listFor(false) }} />);
      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await open();
      expect(await screen.findByText("Aaron's sizes")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("doesn't fetch on the viewer's own list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<SharedList token="tok" list={listFor(true)} />);
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows no panel and no error when the fetch fails", async () => {
    for (const fetchMock of [
      vi.fn().mockRejectedValue(new Error("offline")),
      vi.fn().mockResolvedValue({ ok: false, json: async () => sizes }),
    ]) {
      vi.stubGlobal("fetch", fetchMock);
      try {
        const { unmount } = render(<SharedList token="tok" list={listFor(false)} />);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
        await settle();
        await open();
        expect(screen.queryByText(/sizes/)).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        unmount();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});

describe("+ My list", () => {
  const member: SharedListData["viewer"] = { signedIn: true, name: "Sam" };
  const listFor = (viewer: SharedListData["viewer"], isOwner = false): SharedListData => ({
    title: "t",
    ...unnamed,
    isOwner,
    viewer,
    items: [item("a", "Kettle")],
  });

  it("is hidden from the list's owner", () => {
    render(<SharedList token="t" list={listFor(member, true)} addToMine={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /to my list/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /to my list/ })).toBeNull();
  });

  it("signed out, leads to sign-up and back here with the gift to add", () => {
    render(<SharedList token="t" list={listFor(guest)} addToMine={vi.fn()} />);
    const link = screen.getByRole("link", { name: "Add Kettle to my list" });
    expect(link.getAttribute("href")).toBe(`/auth/sign-up?next=${encodeURIComponent("/share/t?add=a")}`);
  });

  it("signed in, adds the gift and then says it's on your list", async () => {
    const addToMine = vi.fn().mockResolvedValue({ ok: true });
    render(<SharedList token="t" list={listFor(member)} addToMine={addToMine} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Kettle to my list" }));
    expect(addToMine).toHaveBeenCalledWith("t", "a");
    expect(screen.getByRole("button", { name: "On your list ✓" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Added to your list/)).toBeTruthy();
  });

  it("shows the error when the add fails, and keeps the button", async () => {
    const addToMine = vi.fn().mockResolvedValue({ ok: false, error: "Your list is full. Remove a gift to add this one." });
    render(<SharedList token="t" list={listFor(member)} addToMine={addToMine} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Kettle to my list" }));
    expect(screen.getByRole("alert").textContent).toContain("Your list is full");
    expect(screen.getByRole("button", { name: "Add Kettle to my list" })).toBeTruthy();
  });

  it("back from signing in with ?add=, adds that gift once and drops the param", async () => {
    window.history.replaceState(null, "", "/share/t?add=a");
    try {
      const addToMine = vi.fn().mockResolvedValue({ ok: true });
      render(<SharedList token="t" list={listFor(member)} addToMine={addToMine} />);
      expect(await screen.findByRole("button", { name: "On your list ✓" })).toBeTruthy();
      expect(addToMine).toHaveBeenCalledTimes(1);
      expect(router.replace).toHaveBeenCalledWith("/share/t", { scroll: false });
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});
