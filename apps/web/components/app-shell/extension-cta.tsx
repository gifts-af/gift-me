"use client";

import { Puzzle } from "lucide-react";
import { useId, useState } from "react";
import { useExtensionInstalled, useExtensionStoreUrl } from "@/components/extension-link";

const ABOUT =
  "The GiftsAF extension adds the product you're looking at to your list in one click, from any shop, with its name, price and photo.";

// "Add Extension" in the top bar of every signed-in page, only where the
// extension can be installed (desktop Chrome, Edge, Brave) and isn't yet.
// Hover or focus shows what it does; it opens the store in a new tab, so the
// page isn't left.
export function ExtensionCta() {
  const storeUrl = useExtensionStoreUrl();
  const installed = useExtensionInstalled(storeUrl !== null);
  const aboutId = useId();
  // Escape hides the hover text until the pointer or focus leaves (WCAG 1.4.13).
  const [dismissed, setDismissed] = useState(false);
  if (!storeUrl || installed !== false) return null;
  return (
    // Below 768 px the bar has no room beside Get and Give (T58), so it hides.
    <div
      className="group relative hidden md:block"
      onKeyDown={(e) => e.key === "Escape" && setDismissed(true)}
      onMouseLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
    >
      <a
        href={storeUrl}
        target="_blank"
        rel="noreferrer"
        aria-describedby={aboutId}
        className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold hover:bg-muted"
      >
        <Puzzle className="size-4 flex-none" aria-hidden="true" />
        Add Extension
      </a>
      <div
        id={aboutId}
        role="tooltip"
        className={`invisible absolute right-0 top-full z-50 w-64 pt-2 opacity-0 transition-opacity ${dismissed ? "" : "group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"}`}
      >
        {/* The padding, not a margin, bridges the gap, so the pointer can move onto the text (WCAG 1.4.13). */}
        <p className="rounded-lg border bg-popover p-3 text-[13px] leading-snug text-popover-foreground shadow-md">{ABOUT}</p>
      </div>
    </div>
  );
}
