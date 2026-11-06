import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";

vi.mock("@/modules/lists/actions/lists", () => ({ saveList: vi.fn() }));
vi.mock("@/modules/lists/actions/store-page", () => ({ readStorePage: vi.fn() }));
const { saveList } = await import("@/modules/lists/actions/lists");
const { default: GiftApp, GiftAppSkeleton } = await import("../gift-app.jsx");

const gift = (id, name) => ({
  id,
  name,
  priceCents: 1999,
  imageUrl: null,
  productUrl: null,
  asin: null,
  source: "manual",
  addedAt: 0,
});

const member = {
  user: { email: "jim@example.test" },
  list: { id: "list-1", title: "My list", shareToken: "tok" },
  items: [gift("a", "Kettle"), gift("b", "Novel")],
  loadError: null,
};

const STASH = "giftme:guest-list";

describe("GiftApp", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.mocked(saveList).mockReset());

  describe("the footer (ALL-63)", () => {
    const FOOTER = <p>The footer</p>;

    it("shows below a saved list", () => {
      render(<GiftApp initial={member} footer={FOOTER} />);
      expect(screen.getByText("The footer")).toBeInTheDocument();
    });

    it("stays hidden for a guest", () => {
      render(<GiftApp initial={null} footer={FOOTER} />);
      expect(screen.queryByText("The footer")).not.toBeInTheDocument();
    });

    it("stays hidden when the list couldn't load", () => {
      render(<GiftApp initial={{ ...member, list: null, loadError: "Couldn't load" }} footer={FOOTER} />);
      expect(screen.queryByText("The footer")).not.toBeInTheDocument();
    });

    it("goes away if a later refresh can't load the list", () => {
      const { rerender } = render(<GiftApp initial={member} footer={FOOTER} />);
      expect(screen.getByText("The footer")).toBeInTheDocument();
      rerender(<GiftApp initial={{ ...member, list: null, loadError: "Couldn't load" }} footer={FOOTER} />);
      expect(screen.queryByText("The footer")).not.toBeInTheDocument();
    });

    it("appears once a first save creates the list, with no reload (AC-11)", async () => {
      vi.mocked(saveList).mockResolvedValue({
        ok: true,
        listId: "new-list",
        shareToken: "tok",
        items: [gift("a", "Kettle")],
      });
      render(<GiftApp initial={{ ...member, list: null, items: [gift("a", "Kettle")] }} footer={FOOTER} />);
      expect(screen.queryByText("The footer")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /Remove Kettle/ }));
      await userEvent.click(screen.getAllByRole("button", { name: /^Save/ })[0]);
      expect(await screen.findByText("The footer")).toBeInTheDocument();
    });
  });

  it("moves focus to the list heading after removing a gift", async () => {
    render(<GiftApp initial={member} />);
    await userEvent.click(screen.getByRole("button", { name: /Remove Kettle/ }));
    expect(screen.getByRole("heading", { level: 1, name: "My list" })).toHaveFocus();
    expect(screen.queryByText("Kettle")).not.toBeInTheDocument();
  });

  it("puts Share in the title row for a member", () => {
    render(<GiftApp initial={member} />);
    const row = screen.getByRole("heading", { level: 1, name: "My list" }).parentElement;
    expect(within(row).getByRole("button", { name: /Share/ })).toBeInTheDocument();
  });

  it("has no Share for a guest", () => {
    render(<GiftApp initial={null} />);
    expect(screen.queryByRole("button", { name: /Share/ })).not.toBeInTheDocument();
  });

  // /lists doesn't know who's signed in while this shows (ALL-95).
  it("shows no bar while loading", () => {
    render(<GiftAppSkeleton />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the save bar only when there are unsaved changes", async () => {
    render(<GiftApp initial={member} />);
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Remove Novel/ }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  it("saves, announces it, and hides the save bar", async () => {
    vi.mocked(saveList).mockResolvedValue({
      ok: true,
      listId: "list-1",
      shareToken: "tok",
      items: [gift("a", "Kettle")],
    });
    render(<GiftApp initial={member} />);
    await userEvent.click(screen.getByRole("button", { name: /Remove Novel/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("List saved.")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("shows the save error and keeps the changes", async () => {
    vi.mocked(saveList).mockResolvedValue({
      ok: false,
      error: "Your list couldn't be saved. Check your connection and try again.",
    });
    render(<GiftApp initial={member} />);
    await userEvent.click(screen.getByRole("button", { name: /Remove Novel/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be saved");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });

  // In-app links don't fire beforeunload, so they ask first (design/ui.md >
  // Moving the list app: the "unsaved changes" warning on leaving).
  describe("leaving by an in-app link with unsaved changes", () => {
    // The list app lives at /lists; Home links to /.
    beforeEach(() => window.history.replaceState(null, "", "/lists"));
    afterEach(() => {
      vi.restoreAllMocks();
      window.history.replaceState(null, "", "/");
    });

    // Reports whether the click reached the link, where Next's <Link>
    // handler would start the client-side navigation.
    function clickHome() {
      const link = screen.getByRole("link", { name: "Give" });
      let reached = false;
      link.addEventListener("click", () => (reached = true));
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      link.dispatchEvent(click);
      return { reached, prevented: click.defaultPrevented };
    }

    it("stays on the page when the member cancels", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(
        <>
          <Link href="/">Give</Link>
          <GiftApp initial={member} />
        </>,
      );
      await userEvent.click(screen.getByRole("button", { name: /Remove Novel/ }));
      expect(clickHome()).toEqual({ reached: false, prevented: true });
      expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/unsaved/i));
    });

    it("lets the member go when they confirm", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(
        <>
          <Link href="/">Give</Link>
          <GiftApp initial={member} />
        </>,
      );
      await userEvent.click(screen.getByRole("button", { name: /Remove Novel/ }));
      expect(clickHome().reached).toBe(true);
      expect(window.confirm).toHaveBeenCalled();
    });

    it("doesn't ask when everything is saved", () => {
      const confirm = vi.spyOn(window, "confirm");
      render(
        <>
          <Link href="/">Give</Link>
          <GiftApp initial={member} />
        </>,
      );
      expect(clickHome().reached).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  it("asks before something that leaves the page without being a link, like Sign out", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const signOut = vi.fn();
    render(
      <>
        <button data-leaves-page="" onClick={signOut}>
          Sign out
        </button>
        <GiftApp initial={member} />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Remove Novel/ }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/unsaved/i));
    expect(signOut).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("shows the share notice below the title, so Share doesn't move when it appears", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<GiftApp initial={{ ...member, shareToken: "abc" }} />);
    await userEvent.click(screen.getByRole("button", { name: /Share/ }));
    const notice = await screen.findByLabelText("Share link");
    const title = screen.getByRole("heading", { level: 1, name: "My list" });
    expect(title.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("stashes a guest's gifts when they leave for sign-in", () => {
    const guest = render(<GiftApp initial={null} />);
    // A guest starts empty; add one the way a stash would bring it back.
    localStorage.setItem(STASH, JSON.stringify({ items: [gift("x", "Socks")], at: Date.now() }));
    guest.unmount();
    const again = render(<GiftApp initial={null} />);
    expect(screen.getByText("Socks")).toBeInTheDocument();
    again.unmount();
    expect(JSON.parse(localStorage.getItem(STASH)).items.map((g) => g.name)).toEqual(["Socks"]);
  });

  it("brings a stashed list over after sign-in, with a notice", async () => {
    localStorage.setItem(STASH, JSON.stringify({ items: [gift("x", "Socks")], at: Date.now() }));
    await act(async () => render(<GiftApp initial={member} />));
    expect(screen.getByText("Socks")).toBeInTheDocument();
    expect(screen.getByText(/We brought over 1 gift from before you signed in/)).toBeInTheDocument();
    expect(localStorage.getItem(STASH)).toBeNull();
  });

  it("tells a guest to sign in to keep their list", () => {
    render(<GiftApp initial={null} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login?next=%2Flists");
    expect(screen.queryByRole("button", { name: /Share/ })).not.toBeInTheDocument();
  });
});
