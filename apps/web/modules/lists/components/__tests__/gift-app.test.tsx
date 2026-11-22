import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { Activity, type ComponentProps } from "react";
import { finishBeforeLeaving } from "@/lib/leaving-page";
import type { Gift, MyList } from "@/modules/lists/lib/lists";

vi.mock("@/modules/lists/actions/lists", () => ({ saveList: vi.fn() }));
vi.mock("@/modules/lists/actions/store-page", () => ({ readStorePage: vi.fn() }));
vi.mock("@/modules/lists/actions/amazon-lookup", () => ({ lookUpAmazon: vi.fn() }));
const { saveList } = await import("@/modules/lists/actions/lists");
const { default: GiftApp, GiftAppSkeleton, UNDO_MS } = await import("../gift-app");

type SaveListResult = Awaited<ReturnType<typeof saveList>>;
type SaveName = NonNullable<ComponentProps<typeof GiftApp>["saveName"]>;

// The app always sends whole gifts; saveList takes partial ones because it re-checks them.
const whole = (items: Partial<Gift>[]) => items as Gift[];

const gift = (id: string, name: string): Gift => ({
  id,
  name,
  priceCents: 1999,
  imageUrl: null,
  productUrl: null,
  asin: null,
  source: "manual",
  addedAt: 0,
});

const member: MyList = {
  user: { email: "jim@example.test" },
  list: { id: "list-1", title: "My list", shareToken: "tok", version: "v1" },
  items: [gift("a", "Kettle"), gift("b", "Novel")],
  loadError: null,
};

const STASH = "giftme:guest-list";

// What each save sent, by gift name.
const sentNames = () => vi.mocked(saveList).mock.calls.map(([input]) => input.items.map((g) => g.name));

// A save that answers only when the test says so.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let version = 1;
function savesSucceed() {
  vi.mocked(saveList).mockImplementation(async ({ items }) => ({
    ok: true,
    listId: "list-1",
    shareToken: "tok",
    version: `v${++version}`,
    items: whole(items),
  }));
}

let user: ReturnType<typeof userEvent.setup>;
async function addByHand(name: string) {
  await user.click(screen.getByRole("button", { name: "Add by hand" }));
  await user.type(screen.getByLabelText("Gift name"), name);
  await user.type(screen.getByLabelText("Price"), "12");
  await user.click(screen.getByRole("button", { name: "Add to list" }));
}

const remove = (name: string) => user.click(screen.getByRole("button", { name: new RegExp(`Remove ${name}`) }));
const beforeUnloadBlocked = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
// The Undo window waits while the bar has focus, as it does right after a remove.
const leaveUndo = () => act(async () => screen.getByRole("heading", { level: 1, name: "My list" }).focus());
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
      const save = deferred<SaveListResult>();
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
        return { ok: true, listId: "list-1", shareToken: "tok", version: `v${++version}`, items: whole(items) };
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
      await leaveUndo();
      await act(async () => vi.advanceTimersByTime(UNDO_MS - 100));
      expect(saveList).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(100));
      expect(sentNames()).toEqual([["Kettle"]]);
      expect(screen.queryByText("Removed Novel")).not.toBeInTheDocument();
    });

    describe("Undo for keyboard and screen-reader users", () => {
      it("moves focus to Undo and announces it", async () => {
        render(<GiftApp initial={member} />);
        await remove("Kettle");
        expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
        expect(screen.getByText("Removed Kettle. Undo available.")).toHaveClass("sr-only");
      });

      it("waits while Undo has focus, and counts on once focus leaves", async () => {
        render(<GiftApp initial={member} />);
        await remove("Novel");
        await act(async () => vi.advanceTimersByTime(UNDO_MS * 3));
        expect(saveList).not.toHaveBeenCalled();
        await leaveUndo();
        await act(async () => vi.advanceTimersByTime(UNDO_MS));
        expect(sentNames()).toEqual([["Kettle"]]);
      });

      it("waits while the pointer is over the bar, and counts on from where it was", async () => {
        render(<GiftApp initial={member} />);
        await remove("Novel");
        await leaveUndo();
        await act(async () => vi.advanceTimersByTime(UNDO_MS - 1000));
        const bar = screen.getByText("Removed Novel").parentElement!;
        fireEvent.mouseEnter(bar);
        await act(async () => vi.advanceTimersByTime(UNDO_MS * 3));
        expect(saveList).not.toHaveBeenCalled();
        fireEvent.mouseLeave(bar);
        await act(async () => vi.advanceTimersByTime(900));
        expect(saveList).not.toHaveBeenCalled();
        await act(async () => vi.advanceTimersByTime(100));
        expect(sentNames()).toEqual([["Kettle"]]);
      });

      it("puts focus on the heading after Undo", async () => {
        render(<GiftApp initial={member} />);
        await remove("Kettle");
        await user.click(screen.getByRole("button", { name: "Undo" }));
        expect(screen.getByRole("heading", { level: 1, name: "My list" })).toHaveFocus();
      });
    });

    // The server action's version and gifts must come from one snapshot, and
    // the app only removes what this tab removed: a gift another device added
    // must never be treated as removed here (ALL-127 review).
    it("never removes a gift it didn't remove, even when its record of the list is off", async () => {
      const first = deferred();
      const dad = gift("d", "Dad's pick");
      let firstItems: Gift[] = [];
      vi.mocked(saveList)
        // The first save reports a gift ("Dad's pick") this tab never showed.
        .mockImplementationOnce(({ items }) => {
          firstItems = whole(items);
          return first.promise.then(() => ({
            ok: true,
            listId: "list-1",
            shareToken: "tok",
            version: "v2",
            items: [...firstItems, dad],
          }));
        })
        .mockImplementationOnce(async () => ({
          ok: false,
          stale: true,
          listId: "list-1",
          shareToken: "tok",
          version: "v3",
          items: [...firstItems, dad],
        }));
      render(<GiftApp initial={member} />);
      await addByHand("Lamp");
      await addByHand("Socks");
      await act(async () => first.resolve());
      expect(saveList).toHaveBeenCalledTimes(3);
      expect(sentNames()[2]).toEqual(["Kettle", "Novel", "Lamp", "Dad's pick", "Socks"]);
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

      const hideTab = () =>
        act(async () => {
          Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      const closeRoute = (version = "v2", behind = false) =>
        vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ version, behind }, { status: 200 }));

      // Phones often never fire pagehide, so a hidden tab sends it the way a
      // closing one does.
      it("when the tab is hidden, to the close route with keepalive", async () => {
        const fetch = closeRoute();
        render(<GiftApp initial={member} />);
        await remove("Novel");
        await hideTab();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({ listId: "list-1", version: "v1", removeIds: ["b"] });
        expect(saveList).not.toHaveBeenCalled();
      });

      it("and the tab carries on from the version the route saved", async () => {
        closeRoute("v2");
        render(<GiftApp initial={member} />);
        await remove("Novel");
        await hideTab();
        Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
        await addByHand("Lamp");
        expect(vi.mocked(saveList).mock.calls[0][0]).toMatchObject({ version: "v2" });
        expect(sentNames()).toEqual([["Kettle", "Lamp"]]);
      });

      it("when the page is unmounted", async () => {
        const app = render(<GiftApp initial={member} />);
        await remove("Novel");
        app.unmount();
        expect(sentNames()).toEqual([["Kettle"]]);
      });

      it("when the tab closes, to the close route with keepalive, once", async () => {
        const fetch = closeRoute();
        render(<GiftApp initial={member} />);
        await remove("Novel");
        await act(async () => window.dispatchEvent(new Event("pagehide")));
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe("/api/lists/save-on-close");
        expect(init).toMatchObject({ method: "POST", keepalive: true, headers: { "Content-Type": "application/json" } });
        expect(JSON.parse(init?.body as string)).toEqual({ listId: "list-1", version: "v1", removeIds: ["b"] });
        // The tab hiding just after, or the window closing, sends nothing more.
        await hideTab();
        await act(async () => vi.advanceTimersByTime(UNDO_MS));
        expect(fetch).toHaveBeenCalledTimes(1);
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
      const save = deferred<SaveListResult>();
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

    // Next keeps a page left in the app mounted under <Activity mode="hidden">;
    // its effects clean up, but what they started has to finish safely.
    describe("hidden by the router", () => {
      const app = (mode: "visible" | "hidden") => (
        <Activity mode={mode}>
          <GiftApp initial={member} />
        </Activity>
      );

      it("sends a held remove, and Sign out still waits for it", async () => {
        const save = deferred<SaveListResult>();
        vi.mocked(saveList).mockReturnValueOnce(save.promise);
        const view = render(app("visible"));
        await remove("Novel");
        view.rerender(app("hidden"));
        expect(sentNames()).toEqual([["Kettle"]]);
        let left = false;
        const leaving = finishBeforeLeaving().then(() => (left = true));
        await act(async () => {});
        expect(left).toBe(false);
        await act(async () => save.resolve({ ok: true, listId: "list-1", shareToken: "tok", version: "v2", items: [] }));
        await leaving;
        expect(left).toBe(true);
      });

      it("still warns before the tab closes while a save there is on its way, or has failed", async () => {
        const save = deferred<SaveListResult>();
        vi.mocked(saveList).mockReturnValueOnce(save.promise);
        const view = render(app("visible"));
        await addByHand("Lamp");
        view.rerender(app("hidden"));
        expect(beforeUnloadBlocked()).toBe(true);
        await act(async () => save.resolve({ ok: false, error: "Nope." }));
        expect(beforeUnloadBlocked()).toBe(true);
        view.rerender(app("visible"));
        await user.click(screen.getByRole("button", { name: "Try again" }));
        expect(await screen.findByRole("status", { name: "Save status" })).toHaveTextContent("Saved");
        expect(beforeUnloadBlocked()).toBe(false);
      });
    });

    describe("a stale tab (AC-14)", () => {
      const latest = [gift("a", "Kettle"), gift("b", "Novel"), gift("x", "Scarf")];
      const stale: SaveListResult = { ok: false, stale: true, listId: "list-1", shareToken: "tok", version: "v9", items: latest };

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
        await leaveUndo();
        await act(async () => vi.advanceTimersByTime(UNDO_MS));
        expect(sentNames()).toEqual([["Kettle"], ["Kettle", "Scarf"]]);
      });

      it("shows Couldn't save if the second save is refused too", async () => {
        vi.mocked(saveList)
          .mockResolvedValueOnce(stale)
          .mockResolvedValueOnce({ ...stale, version: "v10" });
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
      const failed: SaveListResult = { ok: false, error: "Your list couldn't be saved. Try again." };

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
        const save = deferred<SaveListResult>();
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

      const withLink = (initial: MyList | null) => (
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
    const row = screen.getByRole("heading", { level: 1, name: "My list" }).parentElement!;
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

  describe("asking for a name on Share (ALL-136)", () => {
    const SKIP_KEY = "giftsaf:skip-name-prompt";
    let writeText: Mock<(text: string) => Promise<void>>;
    beforeEach(() => {
      writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      localStorage.removeItem(SKIP_KEY);
    });

    it("asks first, then saves the name and copies the link", async () => {
      const saveName = vi.fn<SaveName>(async () => ({ ok: true }));
      render(<GiftApp initial={member} needsName saveName={saveName} />);
      await user.click(screen.getByRole("button", { name: /Share/ }));
      const dialog = await screen.findByRole("dialog", { name: "What name should your list show?" });
      expect(within(dialog).getByLabelText("Your name")).toHaveValue("");
      await user.type(within(dialog).getByLabelText("Your name"), "  Aaron ");
      await user.click(within(dialog).getByRole("button", { name: "Save and copy link" }));
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/share/tok`);
      expect(saveName).toHaveBeenCalledWith("Aaron");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Copied!/ })).toBeInTheDocument();

      // Named now: the next Share just copies.
      await user.click(screen.getByRole("button", { name: /Copied!/ }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(writeText).toHaveBeenCalledTimes(2);
    });

    it("Skip copies the link without a name, and isn't asked again on this device", async () => {
      const saveName = vi.fn<SaveName>();
      const { unmount } = render(<GiftApp initial={member} needsName saveName={saveName} />);
      await user.click(screen.getByRole("button", { name: /Share/ }));
      await user.click(await screen.findByRole("button", { name: "Skip" }));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole("button", { name: /Copied!/ })).toBeInTheDocument();
      expect(saveName).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      unmount();

      render(<GiftApp initial={member} needsName saveName={saveName} />);
      await user.click(screen.getByRole("button", { name: /Share/ }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(writeText).toHaveBeenCalledTimes(2);
    });

    it("keeps the dialog open with the error when the name can't be saved", async () => {
      const saveName = vi.fn<SaveName>(async () => ({ ok: false, error: "Your name couldn't be saved. Try again." }));
      render(<GiftApp initial={member} needsName saveName={saveName} />);
      await user.click(screen.getByRole("button", { name: /Share/ }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText("Your name"), "Aaron");
      await user.click(within(dialog).getByRole("button", { name: "Save and copy link" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Your name couldn't be saved. Try again.");
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    it("needs a name to save: an empty one is refused without calling the server", async () => {
      const saveName = vi.fn<SaveName>();
      render(<GiftApp initial={member} needsName saveName={saveName} />);
      await user.click(screen.getByRole("button", { name: /Share/ }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Save and copy link" }));
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Type a name, or tap Skip.");
      expect(saveName).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    });

    it("doesn't ask someone who has a name", async () => {
      render(<GiftApp initial={member} saveName={vi.fn<SaveName>()} />);
      await user.click(screen.getByRole("button", { name: /Share/ }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(writeText).toHaveBeenCalledTimes(1);
    });
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

    it("takes the stash once, however often the page is hidden and shown", async () => {
      localStorage.setItem(STASH, JSON.stringify({ items: [gift("x", "Socks")], at: Date.now() }));
      const app = (mode: "visible" | "hidden") => (
        <Activity mode={mode}>
          <GiftApp initial={null} />
        </Activity>
      );
      const view = render(app("visible"));
      await act(async () => {});
      view.rerender(app("hidden"));
      view.rerender(app("visible"));
      await act(async () => {});
      expect(visibleNames()).toEqual(["Socks"]);
    });

    it("stashes their gifts when they leave for sign-in", () => {
      const guest = render(<GiftApp initial={null} />);
      // A guest starts empty; add one the way a stash would bring it back.
      localStorage.setItem(STASH, JSON.stringify({ items: [gift("x", "Socks")], at: Date.now() }));
      guest.unmount();
      const again = render(<GiftApp initial={null} />);
      expect(screen.getByText("Socks")).toBeInTheDocument();
      again.unmount();
      expect(JSON.parse(localStorage.getItem(STASH)!).items.map((g: Gift) => g.name)).toEqual(["Socks"]);
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
