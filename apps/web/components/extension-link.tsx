"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

// Desktop Chromium (Chrome, Edge, Brave) can install from the Chrome Web Store;
// phones and other browsers can't, so they get plain text (ALL-65).
export function canInstallExtension(userAgent: string): boolean {
  return /Chrome\//.test(userAgent) && !/Mobile|Android/.test(userAgent);
}

const subscribe = () => () => {};

/** The store listing's URL on desktop Chrome, else null. Null on the server, so hydration matches. */
export function useExtensionStoreUrl(): string | null {
  const canInstall = useSyncExternalStore(
    subscribe,
    () => canInstallExtension(navigator.userAgent),
    () => false,
  );
  const url = process.env.NEXT_PUBLIC_EXTENSION_STORE_URL;
  return canInstall && url ? url : null;
}


type Runtime = { sendMessage: (id: string, message: unknown, reply: (r: unknown) => void) => void; lastError?: unknown };

// Whether the GiftsAF extension is installed in this browser: null until known.
// The extension answers every message from this site (anything but a sign-in
// gets "Not allowed"), so any reply means it's there. No reply, or no
// chrome.runtime at all, means it isn't. The ping carries nothing.
export function useExtensionInstalled(enabled: boolean): boolean | null {
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

/** Links its text to the extension's store listing where it can be installed. */
export function ExtensionLink({ children }: { children: ReactNode }) {
  const url = useExtensionStoreUrl();
  if (!url) return <>{children}</>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">
      {children}
    </a>
  );
}
