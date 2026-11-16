import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * False in the server render and until the page's JavaScript has loaded, then
 * true. Button, DialogTrigger and Switch use it to look not ready until then,
 * since an early tap does nothing (ALL-104, ALL-110); see design/ui.md >
 * Buttons before the page has loaded.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
