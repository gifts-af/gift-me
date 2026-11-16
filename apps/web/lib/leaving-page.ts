// Sign out leaves with a full page load, which cuts off anything a page is
// still sending. My list may be sending a remove held for Undo (ALL-127), but
// AccountMenu sits in the shared top bar and can't import a product's
// component, so the two meet here: before signing out, the menu asks every
// page for its work in progress and waits for it.

const EVENT = "giftsaf:before-leaving";

// The longest Sign out waits. A save that never answers mustn't trap the
// person signed in; like UNDO_MS, a UI timing rather than a setting.
export const LEAVE_WAIT_MS = 3000;

type Detail = { waitFor: (work: Promise<unknown>) => void };

/**
 * Resolves once every page that has work on its way has finished it, or after
 * LEAVE_WAIT_MS, whichever is first. Work that fails doesn't stop leaving.
 */
export async function finishBeforeLeaving(): Promise<void> {
  const work: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { waitFor: (p) => work.push(p) } }));
  if (work.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => (timer = setTimeout(resolve, LEAVE_WAIT_MS)));
  await Promise.race([Promise.allSettled(work), giveUp]);
  clearTimeout(timer);
}

/** Calls `finish` before the page is left; returns the unsubscribe. */
export function onBeforeLeaving(finish: () => Promise<unknown>): () => void {
  const listener = (event: Event) => (event as CustomEvent<Detail>).detail.waitFor(finish());
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
