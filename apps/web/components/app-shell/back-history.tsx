"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

// Going back to the page you came from returns you to where you were on it,
// not to its top (ALL-131). A link to the page before, like "‹ Mom", opens it
// as a new visit, and a new visit starts at the top; the browser's own Back
// keeps your place. So when the page a link goes back to is the one you just
// came from, we go back in history instead.

type Back = { previous: { current: string | null }; back: () => void };
const BackContext = createContext<Back | null>(null);

/** Remembers the page before this one, for `useGoBack`. Wraps the whole app. */
export function BackHistory({ children }: { children: React.ReactNode }) {
  const previous = useRef<string | null>(null);
  const router = useRouter();
  const value = useMemo(() => ({ previous, back: () => router.back() }), [router]);
  return (
    <BackContext.Provider value={value}>
      {children}
      {/* Reading the address makes a page dynamic, so only this reads it. */}
      <Suspense fallback={null}>
        <TrackPath previous={previous} />
      </Suspense>
    </BackContext.Provider>
  );
}

function TrackPath({ previous }: { previous: { current: string | null } }) {
  const pathname = usePathname();
  const current = useRef<string | null>(null);
  useEffect(() => {
    if (pathname === current.current) return;
    previous.current = current.current;
    current.current = pathname;
  }, [pathname, previous]);
  return null;
}

/**
 * Returns a click handler for a link or button that leads back to `href`.
 * If `href` is the page you came from, it goes back in history and says so
 * by returning true; otherwise it returns false and the caller goes there.
 */
export function useGoBack(href: string): () => boolean {
  const context = useContext(BackContext);
  return useCallback(() => {
    if (!context || context.previous.current !== href) return false;
    context.back();
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
