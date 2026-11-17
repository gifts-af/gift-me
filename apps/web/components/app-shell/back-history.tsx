"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

// Going back to the page you came from returns you to where you were on it,
// not to its top (ALL-131). A link back, like "‹ Mom", opens the page as a new
// visit, which starts at the top. Going back in history would keep your place
// but can show the page as it was before you saved, so instead we open it as
// usual, fresh, and scroll it to where you left it.

type Memory = {
  /** The page before this one. */
  previous: { current: string | null };
  /** Where you were on each page when you last tapped something on it. */
  positions: Map<string, number>;
  /** A page we're opening that should land where you left it. */
  restore: { current: { path: string; y: number } | null };
};

const BackContext = createContext<{ memory: Memory; open: (href: string) => void } | null>(null);

/** Remembers the page before this one and your place on it, for `useGoBack`. Wraps the whole app. */
export function BackHistory({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const memory = useMemo<Memory>(
    () => ({ previous: { current: null }, positions: new Map(), restore: { current: null } }),
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

function TrackPath({ memory }: { memory: Memory }) {
  const pathname = usePathname();
  const current = useRef<string | null>(null);

  // Every way off a page by hand starts with a click (Enter on a link clicks
  // it too), so note your place on the page as you tap.
  useEffect(() => {
    const note = () => {
      if (current.current) memory.positions.set(current.current, window.scrollY);
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
    // The page may still be growing to its full height, so try for a moment.
    let frames = 0;
    let id = 0;
    const step = () => {
      window.scrollTo(0, restore.y);
      if (Math.abs(window.scrollY - restore.y) > 1 && ++frames < 30) id = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(id);
  }, [pathname, memory]);
  return null;
}

/**
 * Returns a click handler for a link or button that leads back to `href`.
 * If `href` is the page you came from, it opens it where you left it and
 * returns true; otherwise it returns false and the caller goes there itself.
 */
export function useGoBack(href: string): () => boolean {
  const context = useContext(BackContext);
  return useCallback(() => {
    if (!context || context.memory.previous.current !== href) return false;
    const y = context.memory.positions.get(href);
    if (y === undefined) return false;
    context.memory.restore.current = { path: href, y };
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
