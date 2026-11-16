"use client";

import { useSyncExternalStore, type ReactNode } from "react";

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
