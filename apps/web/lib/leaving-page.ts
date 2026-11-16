// Sign out leaves with a full page load, which would cut off anything a page
// is still sending. Before it goes, it asks the page for that work and waits
// (ALL-127: My list's remove held for Undo). Work that fails doesn't stop
// sign-out.

const EVENT = "giftsaf:before-leaving";

type Detail = { waitFor: (work: Promise<unknown>) => void };

/** Resolves once every page that has work on its way has finished it. */
export async function finishBeforeLeaving(): Promise<void> {
  const work: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { waitFor: (p) => work.push(p) } }));
  await Promise.allSettled(work);
}

/** Calls `finish` before the page is left; returns the unsubscribe. */
export function onBeforeLeaving(finish: () => Promise<unknown>): () => void {
  const listener = (event: Event) => (event as CustomEvent<Detail>).detail.waitFor(finish());
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
