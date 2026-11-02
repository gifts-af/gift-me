import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * False in the server render and until the page's JavaScript has loaded, then
 * true. Forms disable their submit button until then, so an early tap can't
 * send them the browser's own way (ALL-60).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
