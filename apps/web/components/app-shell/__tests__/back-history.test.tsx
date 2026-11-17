import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The app's router, played by hand: `push` changes the path and re-renders.
let path = "/people/p";
let rerender: () => void = () => {};
const push = vi.fn((href: string) => {
  path = href;
  rerender();
});
vi.mock("next/navigation", () => ({
  usePathname: () => path,
  useRouter: () => ({ push }),
}));

const { BackHistory, BackLink, RESTORE_WAIT_MS } = await import("../back-history");

// The person's page, with its address row lower down, or the address screen.
function App({ showRow = true }: { showRow?: boolean }) {
  return (
    <StrictMode>
      <BackHistory>
        {path === "/people/p" ? (
          // A plain link: this test plays the router itself, by hand.
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          showRow && <a href="/people/p/address">Shipping address</a>
        ) : (
          <BackLink href="/people/p" label="Mom" />
        )}
      </BackHistory>
    </StrictMode>
  );
}

// jsdom lays nothing out, so say where the row is on the screen.
let rowTop = 0;
beforeEach(() => {
  path = "/people/p";
  push.mockClear();
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ top: rowTop }) as DOMRect);
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function openRowThenComeBack(showRowOnReturn = true) {
  const view = render(<App />);
  rerender = () => view.rerender(<App showRow={showRowOnReturn} />);
  rowTop = 300;
  fireEvent.click(screen.getByRole("link", { name: "Shipping address" }));
  path = "/people/p/address";
  rerender();
  rowTop = 40; // Opened again, the page starts at the top, so the row sits higher.
  fireEvent.click(screen.getByRole("link", { name: "Mom" }));
  return view;
}

describe("BackLink (ALL-131)", () => {
  it("opens the page you came from with the row you tapped back in place, and focused, in StrictMode too", () => {
    openRowThenComeBack();
    expect(push).toHaveBeenCalledWith("/people/p", { scroll: false });
    expect(window.scrollBy).toHaveBeenCalledWith(0, 40 - 300);
    expect(screen.getByRole("link", { name: "Shipping address" })).toHaveFocus();
  });

  it("waits for the row if the page is still loading", async () => {
    const view = openRowThenComeBack(false);
    expect(window.scrollBy).not.toHaveBeenCalled();
    await act(async () => view.rerender(<App />));
    expect(window.scrollBy).toHaveBeenCalledWith(0, 40 - 300);
    expect(screen.getByRole("link", { name: "Shipping address" })).toHaveFocus();
  });

  it("but not forever", async () => {
    vi.useFakeTimers();
    const view = openRowThenComeBack(false);
    expect(RESTORE_WAIT_MS).toBeGreaterThan(0);
    await act(async () => {
      vi.advanceTimersByTime(RESTORE_WAIT_MS);
    });
    // The row turns up too late: you're left where you are.
    await act(async () => view.rerender(<App />));
    expect(window.scrollBy).not.toHaveBeenCalled();
  });
});
