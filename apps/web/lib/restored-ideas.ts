// Ideas that came back after "None of these" (T85): the first line of the heads-up email and the
// line above them on the round screen are the same words.

/** How the search that brought them back ended: it found nothing, or it broke off on our side. */
export type Restored = "none" | "failed";

export const RESTORED_LINE: Record<Restored, string> = {
  none: "We didn't find anything new. These are still here if you want one.",
  failed: "We couldn't finish looking. These are still here if you want one.",
};

/** idea_runs.outcome as the words see it: anything but a search that truly found nothing is ours. */
export const restoredFrom = (outcome: string | null | undefined): Restored => (outcome === "none" ? "none" : "failed");
