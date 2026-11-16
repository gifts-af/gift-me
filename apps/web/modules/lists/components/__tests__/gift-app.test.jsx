import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { finishBeforeLeaving } from "@/lib/leaving-page";

vi.mock("@/modules/lists/actions/lists", () => ({ saveList: vi.fn() }));
vi.mock("@/modules/lists/actions/store-page", () => ({ readStorePage: vi.fn() }));
const { saveList } = await import("@/modules/lists/actions/lists");
const { default: GiftApp, GiftAppSkeleton, UNDO_MS } = await import("../gift-app.jsx");

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
  list: { id: "list-1", title: "My list", shareToken: "tok", version: "v1" },
  items: [gift("a", "Kettle"), gift("b", "Novel")],
  loadError: null,
};

const STASH = "giftme:guest-list";

// What each save sent, by gift name.
const sentNames = () => vi.mocked(saveList).mock.calls.map(([input]) => input.items.map((g) => g.name));

// A save that answers only when the test says so.
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

let version = 1;
function savesSucceed() {
  vi.mocked(saveList).mockImplementation(async ({ items }) => ({
    ok: true,
    listId: "list-1",
    shareToken: "tok",
    version: `v${++version}`,
    items,
  }));
}

let user;
async function addByHand(name) {
  await user.click(screen.getByRole("button", { name: "Add by hand" }));
  await user.type(screen.getByLabelText("Gift name"), name);
  await user.type(screen.getByLabelText("Price"), "12");
  await user.click(screen.getByRole("button", { name: "Add to list" }));
}

const remove = (name) => user.click(screen.getByRole("button", { name: new RegExp(`Remove ${name}`) }));
const visibleNames = () => screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);

describe("GiftApp", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    version = 1;
    vi.mocked(saveList).mockReset();
    savesSucceed();
  });
  // The mock stays answering here: unmounting sends a held remove.
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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
      render(<GiftApp initial={{ ...member, list: null, items: [] }} footer={FOOTER} />);
      expect(screen.queryByText("The footer")).not.toBeInTheDocument();
      await addByHand("Kettle");
      expect(await screen.findByText("The footer")).toBeInTheDocument();
      expect(saveList).toHaveBeenCalledWith(expect.objectContaining({ listId: null, version: null }));
    });
  });

  describe("saving as you go (ALL-127)", () => {
    it("saves an add straight away, with the list's version, and says Saved", async () => {
      render(<GiftApp initial={member} />);
      expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Saved");
      await addByHand("Lamp");
      expect(saveList).toHaveBeenCalledTimes(1);
      expect(saveList).toHaveBeenCalledWith(expect.objectContaining({ listId: "list-1", version: "v1" }));
      expect(sentNames()).toEqual([["Kettle", "Novel", "Lamp"]]);
      expect(await screen.findByRole("status", { name: "Save status" })).toHaveTextContent("Saved");
      expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
      expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    });

    it("shows Saving… while a save is on its way", async () => {
      const save = deferred();
      vi.mocked(saveList).mockReturnValueOnce(save.promise);
      render(<GiftApp initial={member} />);
      await addByHand("Lamp");
      expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Saving…");
      await act(async () => save.resolve({ ok: true, listId: "list-1", shareToken: "tok", version: "v2", items: [] }));
      expect(screen.getByRole("status", { name: "Save status" })).toHaveTextContent("Saved");
    });

    it("sends one save at a time, and the next carries every change since (AC-13)", async () => {
      const first = deferred();
      let inFlight = 0;
      let most = 0;
      vi.mocked(saveList).mockImplementation(async ({ items }) => {
        inFlight++;
        most = Math.max(most, inFlight);
        if (vi.mocked(saveList).mock.calls.length === 1) await first.promise;
        inFlight--;
        return { ok: true, listId: "list-1", shareToken: "tok", version: `v${++version}`, items };
      });
      render(<GiftApp initial={member} />);
      await addByHand("Lamp");
      await addByHand("Socks");
      expect(saveList).toHaveBeenCalledTimes(1);
      await act(async () => first.resolve());
      expect(saveList).toHaveBeenCalledTimes(2);
      expect(sentNames()[1]).toEqual(["Kettle", "Novel", "Lamp", "Socks"]);
      expect(vi.mocked(saveList).mock.calls[1][0].version).toBe("v2");
      expect(most).toBe(1);
    });

    it("holds a remove for UNDO_MS, then sends it (AC-11)", async () => {
      render(<GiftApp initial={member} />);
      await remove("Novel");
      expect(visibleNames()).toEqual(["Kettle"]);
      expect(screen.getByText("Removed Novel")).toBeVisible();
      await act(async () => vi.advanceTimersByTime(UNDO_MS - 100));
      expect(saveList).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(100));
      expect(sentNames()).toEqual([["Kettle"]]);
      expect(screen.queryByText("Removed Novel")).not.toBeInTheDocument();
    });

    it("moves focus to the list heading after removing a gift", async () => {
      render(<GiftApp initial={member} />);
      await remove("Kettle");
      expect(screen.getByRole("heading", { level: 1, name: "My list" })).toHaveFocus();
    });

    it("puts the gift back in its place on Undo, and sends nothing (AC-12)", async () => {
      render(<GiftApp initial={{ ...member, items: [gift("a", "Kettle"), gift("b", "Novel"), gift("c", "Lamp")] }} />);
      await remove("Novel");
      await user.click(screen.getByRole("button", { name: "Undo" }));
      expect(visibleNames()).toEqual(["Kettle", "Novel", "Lamp"]);
      await act(async () => vi.advanceTimersByTime(UNDO_MS * 2));
      expect(saveList).not.toHaveBeenCalled();
    });

    it("sends the first remove when a second is made, and Undo moves to the second", async () => {
      render(<GiftApp initial={member} />);
      await remove("Kettle");
      await remove("Novel");
      expect(sentNames()).toEqual([["Novel"]]);
      expect(screen.getByText("Removed Novel")).toBeVisible();
      expect(screen.queryByText("Removed Kettle")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Undo" }));
      expect(visibleNames()).toEqual(["Novel"]);
    });

    it("saves an add made during the Undo window with the held gift in its old place", async () => {
      render(<GiftApp initial={{ ...member, items: [gift("a", "Kettle"), gift("b", "Novel"), gift("c", "Lamp")] }} />);
      await remove("Novel");
      await addByHand("Socks");
      expect(sentNames()).toEqual([["Kettle", "Novel", "Lamp", "Socks"]]);
      expect(visibleNames()).toEqual(["Kettle", "Lamp", "Socks"]);
      await user.click(screen.getByRole("button", { name: "Undo" }));
      expect(visibleNames()).toEqual(["Kettle", "Novel", "Lamp", "Socks"]);
    });

    describe("a held remove is sent early when the page goes (AC-17)", () => {
      afterEach(() => {
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      });

      it("when the tab is hidden", async () => {
        render(<GiftApp initial={member} />);
        await remove("Novel");
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        await act(async () => document.dispatchEvent(new Event("visibilitychange")));
        expect(sentNames()).toEqual([["Kettle"]]);
      });

      it("when the page is left in the app or hidden by the router (its effects clean up)", async () => {
        const app = render(<GiftApp initial={member} />);
        await remove("Novel");
        app.unmount();
        expect(sentNames()).toEqual([["Kettle"]]);
      });

      it("when the tab closes, to the close route with keepalive", async () => {
        const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
        render(<GiftApp initial={member} />);
        await remove("Novel");
        await act(async () => window.dispatchEvent(new Event("pagehide")));
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe("/api/lists/save-on-close");
        expect(init).toMatchObject({ method: "POST", keepalive: true, headers: { "Content-Type": "application/json" } });
        expect(JSON.parse(init.body)).toEqual({ listId: "list-1", version: "v1", removeIds: ["b"] });
        // Sent once: the window closing later, or the tab hiding, sends nothing more.
        await act(async () => vi.advanceTimersByTime(UNDO_MS));
        expect(saveList).not.toHaveBeenCalled();
      });

      it("sends nothing on close when nothing is held", async () => {
        const fetch = vi.spyOn(globalThis, "fetch");
        render(<GiftApp initial={member} />);
        await act(async () => window.dispatchEvent(new Event("pagehide")));
        expect(fetch).not.toHaveBeenCalled();
      });
    });

    it("holds Sign out until the held remove is saved (AC-18)", async () => {
      const save = deferred();
      vi.mocked(saveList).mockReturnValueOnce(save.promise);
      const signOut = vi.fn();
      render(
        <>
          <button data-leaves-page="" onClick={() => finishBeforeLeaving().then(signOut)}>
            Sign out
          </button>
          <GiftApp initial={member} />
        </>,
      );
      await remove("Novel");
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      expect(sentNames()).toEqual([["Kettle"]]);
      expect(signOut).not.toHaveBeenCalled();
      await act(async () => save.resolve({ ok: true, listId: "list-1", shareToken: "tok", version: "v2", items: [] }));
      expect(signOut).toHaveBeenCalled();
    });

    describe("a stale tab (AC-14)", () => {
      const latest = [gift("a", "Kettle"), gift("b", "Novel"), gift("x", "Scarf")];
      const stale = { ok: false, stale: true, listId: "list-1", shareToken: "tok", version: "v9", items: latest };

      it("takes the latest list, puts its own add back on top, saves once more, and says so", async () => {
        vi.mocked(saveList).mockResolvedValueOnce(stale);
        render(<GiftApp initial={member} />);
        await addByHand("Socks");
        expect(saveList).toHaveBeenCalledTimes(2);
        expect(vi.mocked(saveList).mock.calls[1][0].version).toBe("v9");
        expect(sentNames()[1]).toEqual(["Kettle", "Novel", "Scarf", "Socks"]);
        expect(visibleNames()).toEqual(["Kettle", "Novel", "Scarf", "Socks"]);
        expect(await screen.findByText("Your list changed somewhere else. We've loaded the latest.")).toBeVisible();
      });

      it("keeps a held remove held, in its place in the latest list", async () => {
        vi.mocked(saveList).mockResolvedValueOnce(stale);
        render(<GiftApp initial={member} />);
        await remove("Novel");
        await addByHand("Socks");
        expect(sentNames()[1]).toEqual(["Kettle", "Novel", "Scarf", "Socks"]);
        expect(visibleNames()).toEqual(["Kettle", "Scarf", "Socks"]);
        await act(async () => vi.advanceTimersByTime(UNDO_MS));
        expect(sentNames()[2]).toEqual(["Kettle", "Scarf", "Socks"]);
      });

      it("re-applies a remove that was sent but refused", async () => {
        vi.mocked(saveList).mockResolvedValueOnce(stale);
        render(<GiftApp initial={member} />);
        await remove("Novel");
        await act(async () => vi.advanceTimersByTime(UNDO_MS));
        expect(sentNames()).toEqual([["Kettle"], ["Kettle", "Scarf"]]);
      });

      it("shows Couldn't save if the second save is refused too", async () => {
        vi.mocked(saveList).mockResolvedValueOnce(stale).mockResolvedValueOnce({ ...stale, version: "v10" });
        render(<GiftApp initial={member} />);
        await addByHand("Socks");
        expect(saveList).toHaveBeenCalledTimes(2);
        expect(await screen.findByRole("status", { name: "Save status" })).toHaveTextContent("Couldn't save");
        expect(visibleNames()).toEqual(["Kettle", "Novel", "Scarf", "Socks"]);
        await user.click(screen.getByRole("button", { name: "Try again" }));
        expect(vi.mocked(saveList).mock.calls[2][0].version).toBe("v10");
        expect(await screen.findByRole("status", { name: "Save status" })).toHaveTextContent("Saved");
      });
    });

    describe("a failed save (AC-15)", () => {
      const failed = { ok: false, error: "Your list couldn't be saved. Try again." };
      const beforeUnloadBlocked = () => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };

      it("says Couldn't save, keeps the gifts, warns before leaving, and Try again saves", async () => {
        vi.mocked(saveList).mockResolvedValueOnce(failed);
        render(<GiftApp initial={member} />);
        expect(beforeUnloadBlocked()).toBe(false);
        await addByHand("Lamp");
        expect(await screen.findByRole("status", { name: "Save status" })).toHaveTextContent("Couldn't save");
        expect(screen.getByRole("alert")).toHaveTextContent("couldn't be saved");
        expect(visibleNames()).toEqual(["Kettle", "Novel", "Lamp"]);
        expect(beforeUnloadBlocked()).toBe(true);
        await user.click(screen.getByRole("button", { name: "Try again" }));
        expect(sentNames()[1]).toEqual(["Kettle", "Novel", "Lamp"]);
        expect(await screen.findByRole("status", { name: "Save status" })).toHaveTextContent("Saved");
        expect(beforeUnloadBlocked()).toBe(false);
      });

      it("warns before leaving while a save is on its way", async () => {
        const save = deferred();
        vi.mocked(saveList).mockReturnValueOnce(save.promise);
        render(<GiftApp initial={member} />);
        await addByHand("Lamp");
        expect(beforeUnloadBlocked()).toBe(true);
        await act(async () => save.resolve({ ok: true, listId: "list-1", shareToken: "tok", version: "v2", items: [] }));
        expect(beforeUnloadBlocked()).toBe(false);
      });

      it("doesn't warn for a remove held for Undo: it's sent as the tab goes", async () => {
        render(<GiftApp initial={member} />);
        await remove("Novel");
        expect(beforeUnloadBlocked()).toBe(false);
      });
    });

    // In-app links don't fire beforeunload, so they ask first, but only when
    // a save failed: a save on its way finishes with the page hidden.
    describe("leaving by an in-app link", () => {
      beforeEach(() => window.history.replaceState(null, "", "/lists"));
      afterEach(() => window.history.replaceState(null, "", "/"));

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

      const withLink = (initial) => (
        <>
          <Link href="/">Give</Link>
          <GiftApp initial={initial} />
        </>
      );

      it("doesn't ask when everything is saved, or a remove is held", async () => {
        const confirm = vi.spyOn(window, "confirm");
        render(withLink(member));
        await remove("Novel");
        expect(clickHome().reached).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
      });

      it("asks after a failed save, and stays when the member cancels", async () => {
        vi.mocked(saveList).mockResolvedValueOnce({ ok: false, error: "Nope." });
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
        render(withLink(member));
        await addByHand("Lamp");
        await screen.findByRole("button", { name: "Try again" });
        expect(clickHome()).toEqual({ reached: false, prevented: true });
        expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/unsaved/i));
      });

      it("asks before Sign out after a failed save", async () => {
        vi.mocked(saveList).mockResolvedValueOnce({ ok: false, error: "Nope." });
        vi.spyOn(window, "confirm").mockReturnValue(false);
        const signOut = vi.fn();
        render(
          <>
            <button data-leaves-page="" onClick={signOut}>
              Sign out
            </button>
            <GiftApp initial={member} />
          </>,
        );
        await addByHand("Lamp");
        await screen.findByRole("button", { name: "Try again" });
        await user.click(screen.getByRole("button", { name: "Sign out" }));
        expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/unsaved/i));
        expect(signOut).not.toHaveBeenCalled();
      });
    });
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

  it("shows the share notice below the title, so Share doesn't move when it appears", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    render(<GiftApp initial={member} />);
    await user.click(screen.getByRole("button", { name: /Share/ }));
    const notice = await screen.findByLabelText("Share link");
    const title = screen.getByRole("heading", { level: 1, name: "My list" });
    expect(title.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe("a guest (AC-16)", () => {
    it("keeps today's behaviour: nothing saves, a remove is immediate, no Undo or status", async () => {
      render(<GiftApp initial={null} />);
      await addByHand("Lamp");
      await addByHand("Socks");
      await remove("Lamp");
      expect(visibleNames()).toEqual(["Socks"]);
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
      expect(screen.queryByRole("status", { name: "Save status" })).not.toBeInTheDocument();
      await act(async () => vi.advanceTimersByTime(UNDO_MS));
      expect(saveList).not.toHaveBeenCalled();
    });

    it("is warned before leaving with gifts on the list", async () => {
      render(<GiftApp initial={null} />);
      await addByHand("Lamp");
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it("stashes their gifts when they leave for sign-in", () => {
      const guest = render(<GiftApp initial={null} />);
      // A guest starts empty; add one the way a stash would bring it back.
      localStorage.setItem(STASH, JSON.stringify({ items: [gift("x", "Socks")], at: Date.now() }));
      guest.unmount();
      const again = render(<GiftApp initial={null} />);
      expect(screen.getByText("Socks")).toBeInTheDocument();
      again.unmount();
      expect(JSON.parse(localStorage.getItem(STASH)).items.map((g) => g.name)).toEqual(["Socks"]);
    });

    it("is told to sign in to keep their list", () => {
      render(<GiftApp initial={null} />);
      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/login?next=%2Flists");
      expect(screen.queryByRole("button", { name: /Share/ })).not.toBeInTheDocument();
    });
  });

  it("brings a stashed list over after sign-in, saves it, and says so", async () => {
    localStorage.setItem(STASH, JSON.stringify({ items: [gift("x", "Socks")], at: Date.now() }));
    await act(async () => render(<GiftApp initial={member} />));
    expect(screen.getByText("Socks")).toBeInTheDocument();
    expect(screen.getByText(/We brought over 1 gift from before you signed in/)).toBeInTheDocument();
    expect(localStorage.getItem(STASH)).toBeNull();
    expect(sentNames()).toEqual([["Kettle", "Novel", "Socks"]]);
  });

  it("keeps the stash and saves nothing when the list couldn't load", async () => {
    localStorage.setItem(STASH, JSON.stringify({ items: [gift("x", "Socks")], at: Date.now() }));
    await act(async () => render(<GiftApp initial={{ ...member, list: null, items: [], loadError: "Couldn't load" }} />));
    expect(localStorage.getItem(STASH)).not.toBeNull();
    expect(saveList).not.toHaveBeenCalled();
  });
});
