"use client";

import { Puzzle } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useExtensionStoreUrl } from "@/components/extension-link";

const ABOUT =
  "The GiftsAF extension adds the product you're looking at to your list in one click, from any shop, with its name, price and photo.";

type Runtime = { sendMessage: (id: string, message: unknown, reply: (r: unknown) => void) => void; lastError?: unknown };

// Whether the GiftsAF extension is installed in this browser: null until known.
// The extension answers every message from this site (anything but a sign-in
// gets "Not allowed"), so any reply means it's there. No reply, or no
// chrome.runtime at all, means it isn't. The ping carries nothing.
function useExtensionInstalled(enabled: boolean): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const id = process.env.NEXT_PUBLIC_EXTENSION_ID;
    const runtime = (globalThis as { chrome?: { runtime?: Runtime } }).chrome?.runtime;
    if (!id || !runtime?.sendMessage) {
      setInstalled(false);
      return;
    }
    try {
      runtime.sendMessage(id, { type: "ping" }, (reply) => {
        // Read lastError so Chrome doesn't log it.
        setInstalled(!runtime.lastError && reply !== undefined);
      });
    } catch {
      setInstalled(false);
    }
  }, [enabled]);
  return installed;
}

// "Add Extension" in the top bar of every signed-in page, only where the
// extension can be installed (desktop Chrome, Edge, Brave) and isn't yet.
// Hover or focus shows what it does; it opens the store in a new tab, so the
// page isn't left.
export function ExtensionCta() {
  const storeUrl = useExtensionStoreUrl();
  const installed = useExtensionInstalled(storeUrl !== null);
  const aboutId = useId();
  if (!storeUrl || installed !== false) return null;
  return (
    <div className="group relative">
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
        className="invisible absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border bg-popover p-3 text-[13px] leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {ABOUT}
      </div>
    </div>
  );
}
