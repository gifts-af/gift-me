"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

// Going back to the page you came from returns you to where you were on it,
// not to its top (ALL-131). A link back, like "‹ Mom", opens the page as a new
// visit, which starts at the top. Going back in history would keep your place
// but can show the page as it was before you saved, so instead we open it as
// usual, fresh, and put the row you tapped back where it was on the screen,
// with focus on it, as the browser's own Back does.

type Spot = { href: string; top: number };
type Memory = {
  /** The page before this one. */
  previous: { current: string | null };
  /** On each page, the last link you tapped and how far down the screen it was. */
  spots: Map<string, Spot>;
  /** A page we're opening that should land where you left it. */
  restore: { current: { path: string; spot: Spot } | null };
};

const BackContext = createContext<{ memory: Memory; open: (href: string) => void } | null>(null);

/** Remembers the page before this one and your place on it, for `useGoBack`. Wraps the whole app. */
export function BackHistory({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const memory = useMemo<Memory>(
    () => ({ previous: { current: null }, spots: new Map(), restore: { current: null } }),
    [],
  );
  const value = useMemo(
    () => ({ memory, open: (href: string) => router.push(href, { scroll: false }) }),
    [memory, router],
  );
  return (
    <BackContext.Provider value={value}>
      {children}
      {/* Reading the address makes a page dynamic, so only this reads it. */}
      <Suspense fallback={null}>
        <TrackPath memory={memory} />
      </Suspense>
    </BackContext.Provider>
  );
}

/** The link on the showing page with this href. Pages the app keeps hidden have it too. */
function shownLink(href: string): HTMLElement | undefined {
  return Array.from(document.links).find((a) => a.getAttribute("href") === href && a.getClientRects().length > 0);
}

function TrackPath({ memory }: { memory: Memory }) {
  const pathname = usePathname();
  const current = useRef<string | null>(null);

  // Leaving a page by hand starts with a tap on a link (Enter on a link
  // clicks it too), so note which one and where it was on the screen.
  useEffect(() => {
    const note = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = link?.getAttribute("href");
      if (!current.current || !link || !href?.startsWith("/")) return;
      memory.spots.set(current.current, { href, top: link.getBoundingClientRect().top });
    };
    document.addEventListener("click", note, true);
    return () => document.removeEventListener("click", note, true);
  }, [memory]);

  useEffect(() => {
    if (pathname === current.current) return;
    memory.previous.current = current.current;
    current.current = pathname;
    const restore = memory.restore.current;
    memory.restore.current = null;
    if (restore?.path !== pathname) return;
    const { href, top } = restore.spot;

    // The page can still be loading, so wait for the row to show. Stop if you
    // start scrolling yourself, or leave.
    const place = () => {
      const link = shownLink(href);
      if (!link) return false;
      window.scrollBy(0, link.getBoundingClientRect().top - top);
      link.focus({ preventScroll: true });
      return true;
    };
    if (place()) return;
    const watch = new MutationObserver(() => {
      if (place()) stop();
    });
    const stop = () => {
      watch.disconnect();
      clearTimeout(timer);
      for (const type of GIVE_UP_ON) window.removeEventListener(type, stop, true);
    };
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden"] });
    const timer = setTimeout(stop, RESTORE_WAIT_MS);
    for (const type of GIVE_UP_ON) window.addEventListener(type, stop, { capture: true, passive: true });
    return stop;
  }, [pathname, memory]);
  return null;
}

/**
 * How long to wait for the row you tapped to show again. Past this, the page is
 * stuck or the row is gone, and moving the page later would only surprise you.
 * A UI timing, like the Undo window, not a business value (T23).
 */
export const RESTORE_WAIT_MS = 10_000;

/** Things you do that mean you've moved on, so we stop trying to put you back. */
const GIVE_UP_ON = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Returns a click handler for a link or button that leads back to `href`.
 * If `href` is the page you came from, it opens it where you left it and
 * returns true; otherwise it returns false and the caller goes there itself.
 */
export function useGoBack(href: string): () => boolean {
  const context = useContext(BackContext);
  return useCallback(() => {
    if (!context || context.memory.previous.current !== href) return false;
    const spot = context.memory.spots.get(href);
    if (!spot) return false;
    context.memory.restore.current = { path: href, spot };
    context.open(href);
    return true;
  }, [context, href]);
}

/** The "‹ Mom" link at the top of a page below Get or Give (ALL-95). */
export function BackLink({ href, label }: { href: string; label: string }) {
  const goBack = useGoBack(href);
  return (
    <Link
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        if (goBack()) event.preventDefault();
      }}
      className="-ml-1 -mb-4 inline-flex min-h-11 max-w-full items-center gap-0.5 self-start pr-2 text-[15px] [overflow-wrap:anywhere]"
    >
      <ChevronLeft className="size-5 flex-none" aria-hidden="true" />
      {label}
    </Link>
  );
}
