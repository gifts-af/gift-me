import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * False in the server render and until the page's JavaScript has loaded, then
 * true. Forms disable their submit button until then, so an early tap can't
 * send them the browser's own way (ALL-60). Buttons outside a form use it to
 * look not ready, since an early tap does nothing (ALL-104).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
